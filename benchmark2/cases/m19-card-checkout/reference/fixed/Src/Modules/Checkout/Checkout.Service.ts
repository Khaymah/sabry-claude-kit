import { and, eq, inArray, sql } from "drizzle-orm";
import { Db } from "../../Database/Db";
import { CheckoutAttempts, Orders, Payments } from "../../Database/Schema";
import { AppError } from "../../Lib/Response";
import { FromPiasters, ToPiasters } from "../../Lib/Money";
import { Charge } from "./Gateway.Client";

async function Claim(CompanyId: number, OrderId: number, CardToken: string) {
  return Db.transaction(async (Tx) => {
    const [Order] = await Tx.select().from(Orders).where(and(eq(Orders.Id, OrderId), eq(Orders.CompanyId, CompanyId)));
    if (!Order) throw new AppError(404, "NOT_FOUND", "Order not found");
    if (Order.Status !== "Pending") throw new AppError(409, "ORDER_NOT_PAYABLE", "Order is not awaiting payment");
    const [Open] = await Tx.select()
      .from(CheckoutAttempts)
      .where(and(eq(CheckoutAttempts.OrderId, OrderId), inArray(CheckoutAttempts.Status, ["InProgress", "Unknown"])));
    if (Open?.Status === "InProgress") throw new AppError(409, "CHECKOUT_IN_PROGRESS", "A checkout for this order is in progress");
    if (Open) {
      if (Open.CardToken !== CardToken) throw new AppError(409, "PAYMENT_PENDING_CONFIRMATION", "A previous card payment is still being confirmed");
      await Tx.update(CheckoutAttempts).set({ Status: "InProgress" }).where(eq(CheckoutAttempts.Id, Open.Id));
      return { ...Open, Status: "InProgress" };
    }
    const [{ Paid }] = await Tx.select({ Paid: sql<string>`coalesce(sum(${Payments.Amount}), 0)::text` })
      .from(Payments)
      .where(and(eq(Payments.OrderId, OrderId), eq(Payments.Status, "Completed")));
    const Amount = ToPiasters(Order.Total) - ToPiasters(Paid);
    if (Amount <= 0) throw new AppError(409, "ORDER_NOT_PAYABLE", "Nothing left to pay");
    const [Attempt] = await Tx.insert(CheckoutAttempts)
      .values({ CompanyId, OrderId, IdempotencyKey: crypto.randomUUID(), CardToken, Amount, Status: "InProgress" })
      .returning();
    return Attempt;
  });
}

export async function Checkout(CompanyId: number, OrderId: number, CardToken: string) {
  const Attempt = await Claim(CompanyId, OrderId, CardToken);
  const Outcome = await Charge(Attempt.IdempotencyKey, {
    Amount: Attempt.Amount,
    Currency: "EGP",
    CardToken: Attempt.CardToken,
    Reference: `order-${OrderId}`,
  });
  const SetStatus = (Status: string, ChargeId: string | null = null) =>
    Db.update(CheckoutAttempts).set({ Status, ChargeId }).where(eq(CheckoutAttempts.Id, Attempt.Id));

  if (Outcome.Kind === "Succeeded") {
    await Db.transaction(async (Tx) => {
      await Tx.update(CheckoutAttempts).set({ Status: "Succeeded", ChargeId: Outcome.ChargeId }).where(eq(CheckoutAttempts.Id, Attempt.Id));
      await Tx.insert(Payments).values({ CompanyId, OrderId, Amount: FromPiasters(Attempt.Amount), Method: "Card", ProviderRef: Outcome.ChargeId });
      await Tx.update(Orders).set({ Status: "Paid" }).where(eq(Orders.Id, OrderId));
    });
    return { OrderStatus: "Paid", ChargeId: Outcome.ChargeId, Amount: FromPiasters(Attempt.Amount) };
  }
  if (Outcome.Kind === "Declined") {
    await SetStatus("Declined");
    throw new AppError(402, "PAYMENT_DECLINED", "The card was declined");
  }
  if (Outcome.Kind === "Rejected") {
    await SetStatus("Failed");
    throw new AppError(502, "GATEWAY_ERROR", "The payment gateway rejected the request");
  }
  await SetStatus("Unknown");
  throw new AppError(504, "GATEWAY_TIMEOUT", "The payment gateway did not answer; the payment may still go through");
}
