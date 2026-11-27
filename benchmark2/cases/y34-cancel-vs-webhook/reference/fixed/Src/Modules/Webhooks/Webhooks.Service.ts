import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { Db } from "../../Database/Db";
import { Orders, Payments, WebhookEvents } from "../../Database/Schema";
import { AppError } from "../../Lib/Response";
import { ToPiasters } from "../../Lib/Money";
import { GetSetting } from "../Settings/Settings.Service";
import { PaymentEvent } from "./Webhooks.Schema";

async function VerifySignature(RawBody: string, Signature: string) {
  const Secret = await GetSetting<string>("PaymentProvider.WebhookSecret", "");
  if (!Secret) throw new AppError(503, "WEBHOOKS_DISABLED", "Webhook secret is not configured");
  const Expected = Buffer.from(createHmac("sha256", Secret).update(RawBody).digest("hex"));
  const Given = Buffer.from(Signature);
  if (Given.length !== Expected.length || !timingSafeEqual(Given, Expected)) throw new AppError(401, "INVALID_SIGNATURE", "Signature mismatch");
}

export async function HandlePaymentWebhook(RawBody: string, Signature: string) {
  await VerifySignature(RawBody, Signature);
  let Parsed: unknown;
  try {
    Parsed = JSON.parse(RawBody);
  } catch {
    throw new AppError(400, "VALIDATION_ERROR", "Body must be valid JSON");
  }
  const Result = PaymentEvent.safeParse(Parsed);
  if (!Result.success) throw new AppError(400, "VALIDATION_ERROR", "Invalid event payload");
  const Event = Result.data;

  return Db.transaction(async (Tx) => {
    const Fresh = await Tx.insert(WebhookEvents).values({ EventId: Event.EventId, Type: Event.Type }).onConflictDoNothing().returning();
    if (Fresh.length === 0) return { Received: true, Duplicate: true };
    if (Event.Type !== "payment.succeeded") return { Received: true };
    const [Order] = await Tx.select().from(Orders).where(eq(Orders.Id, Event.OrderId)).for("update");
    if (!Order) return { Received: true, Ignored: true };
    if (Order.Status === "Cancelled") {
      await Tx.insert(Payments).values({ CompanyId: Order.CompanyId, OrderId: Order.Id, Amount: Event.Amount, Method: "Card", Status: "RefundDue", ProviderRef: Event.ProviderRef });
      return { Received: true, RefundDue: true };
    }
    await Tx.insert(Payments).values({ CompanyId: Order.CompanyId, OrderId: Order.Id, Amount: Event.Amount, Method: "Card", ProviderRef: Event.ProviderRef });
    const [{ Paid }] = await Tx.select({ Paid: sql<string>`coalesce(sum(${Payments.Amount}), 0)::text` })
      .from(Payments)
      .where(and(eq(Payments.OrderId, Order.Id), eq(Payments.Status, "Completed")));
    if (ToPiasters(Paid) >= ToPiasters(Order.Total))
      await Tx.update(Orders).set({ Status: "Paid" }).where(and(eq(Orders.Id, Order.Id), eq(Orders.Status, "Pending")));
    return { Received: true };
  });
}
