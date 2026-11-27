import { and, eq, sql } from "drizzle-orm";
import type { Transaction } from "../../Database/Db";
import { Db } from "../../Database/Db";
import { Orders, Payments, Refunds } from "../../Database/Schema";
import { AppError } from "../../Lib/Response";
import { FromPiasters, ToPiasters } from "../../Lib/Money";

export async function CreatePayment(CompanyId: number, Input: { OrderId: number; Amount: string; Method: string }) {
  const Amount = ToPiasters(Input.Amount);
  if (Amount <= 0) throw new AppError(400, "VALIDATION_ERROR", "Amount must be positive");
  return Db.transaction(async (Tx) => {
    const [Order] = await Tx.select()
      .from(Orders)
      .where(and(eq(Orders.Id, Input.OrderId), eq(Orders.CompanyId, CompanyId)));
    if (!Order) throw new AppError(404, "NOT_FOUND", "Order not found");
    if (Order.Status !== "Pending") throw new AppError(409, "INVALID_STATUS", "Order is not awaiting payment");
    const [{ Paid }] = await Tx.select({ Paid: sql<string>`coalesce(sum(${Payments.Amount}), 0)::text` })
      .from(Payments)
      .where(and(eq(Payments.OrderId, Order.Id), eq(Payments.Status, "Completed")));
    const Remaining = ToPiasters(Order.Total) - ToPiasters(Paid);
    if (Amount > Remaining) throw new AppError(409, "OVERPAYMENT", "Amount exceeds the remaining balance");
    const [Payment] = await Tx.insert(Payments)
      .values({ CompanyId, OrderId: Order.Id, Amount: FromPiasters(Amount), Method: Input.Method })
      .returning();
    const OrderStatus = Amount === Remaining ? "Paid" : "Pending";
    if (OrderStatus === "Paid") await Tx.update(Orders).set({ Status: "Paid" }).where(eq(Orders.Id, Order.Id));
    return { ...Payment, OrderStatus };
  });
}

export async function ListPayments(CompanyId: number, OrderId: number) {
  return Db.select()
    .from(Payments)
    .where(and(eq(Payments.CompanyId, CompanyId), eq(Payments.OrderId, OrderId)))
    .orderBy(Payments.Id);
}

async function RefundSummary(Tx: Transaction | typeof Db, CompanyId: number, PaymentId: number) {
  const [Payment] = await Tx.select()
    .from(Payments)
    .where(and(eq(Payments.Id, PaymentId), eq(Payments.CompanyId, CompanyId)));
  if (!Payment) throw new AppError(404, "NOT_FOUND", "Payment not found");
  const [{ Refunded }] = await Tx.select({ Refunded: sql<string>`coalesce(sum(${Refunds.Amount}), 0)::text` })
    .from(Refunds)
    .where(eq(Refunds.PaymentId, PaymentId));
  const RefundedAmount = ToPiasters(Refunded);
  return { Payment, RefundedAmount, Refundable: ToPiasters(Payment.Amount) - RefundedAmount };
}

export async function CreateRefund(CompanyId: number, PaymentId: number, Input: { Amount: string; Reason?: string }) {
  const Amount = ToPiasters(Input.Amount);
  if (Amount <= 0) throw new AppError(400, "VALIDATION_ERROR", "Amount must be positive");
  return Db.transaction(async (Tx) => {
    const { Payment, RefundedAmount, Refundable } = await RefundSummary(Tx, CompanyId, PaymentId);
    if (Payment.Status !== "Completed") throw new AppError(409, "INVALID_STATUS", "Payment cannot be refunded");
    if (Amount > Refundable) throw new AppError(409, "REFUND_EXCEEDS_PAYMENT", "Amount exceeds the refundable balance");
    const [Refund] = await Tx.insert(Refunds)
      .values({ CompanyId, PaymentId, Amount: FromPiasters(Amount), Reason: Input.Reason })
      .returning();
    const [{ Paid }] = await Tx.select({ Paid: sql<string>`coalesce(sum(${Payments.Amount}), 0)::text` })
      .from(Payments)
      .where(and(eq(Payments.OrderId, Payment.OrderId), eq(Payments.Status, "Completed")));
    const [{ Back }] = await Tx.select({ Back: sql<string>`coalesce(sum(${Refunds.Amount}), 0)::text` })
      .from(Refunds)
      .innerJoin(Payments, eq(Payments.Id, Refunds.PaymentId))
      .where(eq(Payments.OrderId, Payment.OrderId));
    if (ToPiasters(Back) === ToPiasters(Paid))
      await Tx.update(Orders).set({ Status: "Refunded" }).where(and(eq(Orders.Id, Payment.OrderId), eq(Orders.Status, "Paid")));
    return {
      Refund,
      RefundedAmount: FromPiasters(RefundedAmount + Amount),
      RefundableAmount: FromPiasters(Refundable - Amount),
    };
  });
}

export async function ListRefunds(CompanyId: number, PaymentId: number) {
  const { RefundedAmount, Refundable } = await RefundSummary(Db, CompanyId, PaymentId);
  const Items = await Db.select().from(Refunds).where(eq(Refunds.PaymentId, PaymentId)).orderBy(Refunds.Id);
  return { Items, RefundedAmount: FromPiasters(RefundedAmount), RefundableAmount: FromPiasters(Refundable) };
}
