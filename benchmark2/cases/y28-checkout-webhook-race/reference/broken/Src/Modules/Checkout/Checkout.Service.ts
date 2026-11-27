import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { Db } from "../../Database/Db";
import { GatewayEvents, Orders, Payments } from "../../Database/Schema";
import { AppError } from "../../Lib/Response";
import { FromPiasters, ToPiasters } from "../../Lib/Money";
import { GetSetting } from "../Settings/Settings.Service";

export const CheckoutBody = z.object({ CardToken: z.string().trim().min(1).max(200) });

async function RecordCardPayment(OrderId: number, Amount: string, ChargeId: string) {
  await Db.transaction(async (Tx) => {
    const [Order] = await Tx.select().from(Orders).where(eq(Orders.Id, OrderId));
    if (!Order) return;
    await Tx.insert(Payments).values({ CompanyId: Order.CompanyId, OrderId, Amount, Method: "Card", ProviderRef: ChargeId });
    const [{ Paid }] = await Tx.select({ Paid: sql<string>`coalesce(sum(${Payments.Amount}), 0)::text` })
      .from(Payments)
      .where(and(eq(Payments.OrderId, OrderId), eq(Payments.Status, "Completed")));
    if (ToPiasters(Paid) >= ToPiasters(Order.Total)) await Tx.update(Orders).set({ Status: "Paid" }).where(eq(Orders.Id, OrderId));
  });
}

export async function Checkout(CompanyId: number, OrderId: number, CardToken: string) {
  const [Order] = await Db.select().from(Orders).where(and(eq(Orders.Id, OrderId), eq(Orders.CompanyId, CompanyId)));
  if (!Order) throw new AppError(404, "NOT_FOUND", "Order not found");
  if (Order.Status !== "Pending") throw new AppError(409, "ORDER_NOT_PAYABLE", "Order is not awaiting payment");
  const [{ Paid }] = await Db.select({ Paid: sql<string>`coalesce(sum(${Payments.Amount}), 0)::text` }).from(Payments).where(eq(Payments.OrderId, OrderId));
  const Amount = ToPiasters(Order.Total) - ToPiasters(Paid);
  const BaseUrl = await GetSetting<string>("Gateway.BaseUrl", "");
  const ApiKey = await GetSetting<string>("Gateway.ApiKey", "");
  const TimeoutMs = await GetSetting<number>("Gateway.TimeoutMs", 5000);
  const Controller = new AbortController();
  const Timer = setTimeout(() => Controller.abort(), TimeoutMs);
  let ChargeId: string;
  try {
    const Res = await fetch(`${BaseUrl}/v1/charges`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ApiKey}`, "Idempotency-Key": `order-${OrderId}-${Date.now()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ Amount, Currency: "EGP", CardToken, Reference: `order-${OrderId}` }),
      signal: Controller.signal,
    });
    if (Res.status === 402) throw new AppError(402, "PAYMENT_DECLINED", "The card was declined");
    if (!Res.ok) throw new AppError(502, "GATEWAY_ERROR", "The payment gateway failed");
    ChargeId = String(((await Res.json()) as { Id: string }).Id);
  } catch (Err) {
    if (Err instanceof AppError) throw Err;
    throw new AppError(504, "GATEWAY_TIMEOUT", "The payment gateway did not answer");
  } finally {
    clearTimeout(Timer);
  }
  await RecordCardPayment(OrderId, FromPiasters(Amount), ChargeId);
  return { OrderStatus: "Paid", ChargeId };
}

const Event = z.object({
  EventId: z.string().min(1),
  Type: z.string(),
  ChargeId: z.string().min(1),
  OrderId: z.number().int().positive(),
  Amount: z.string().regex(/^\d{1,10}\.\d{2}$/),
});

export async function HandleGatewayWebhook(RawBody: string, Signature: string) {
  const Secret = await GetSetting<string>("Gateway.WebhookSecret", "");
  const Expected = Buffer.from(createHmac("sha256", Secret).update(RawBody).digest("hex"));
  const Given = Buffer.from(Signature);
  if (!Secret || Given.length !== Expected.length || !timingSafeEqual(Given, Expected)) throw new AppError(401, "INVALID_SIGNATURE", "Signature mismatch");
  const Parsed = Event.safeParse(JSON.parse(RawBody));
  if (!Parsed.success) throw new AppError(400, "VALIDATION_ERROR", "Invalid event");
  const E = Parsed.data;
  const Fresh = await Db.insert(GatewayEvents).values({ EventId: E.EventId }).onConflictDoNothing().returning();
  if (Fresh.length === 0) return { Received: true };
  if (E.Type === "charge.succeeded") await RecordCardPayment(E.OrderId, E.Amount, E.ChargeId);
  return { Received: true };
}
