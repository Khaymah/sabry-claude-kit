import { and, eq, sql } from "drizzle-orm";
import { Db } from "../../Database/Db";
import { Orders, PaymentRefundLog, Payments } from "../../Database/Schema";
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

export async function CreateRefund(CompanyId: number, PaymentId: number, Input: { Amount: string; Reason?: string }) {
  const Amount = FromPiasters(ToPiasters(Input.Amount));
  if (ToPiasters(Amount) <= 0) throw new AppError(400, "VALIDATION_ERROR", "Amount must be positive");
  const [Updated] = await Db.update(Payments)
    .set({ RefundedAmount: sql`${Payments.RefundedAmount} + ${Amount}::numeric` })
    .where(and(eq(Payments.Id, PaymentId), eq(Payments.CompanyId, CompanyId), eq(Payments.Status, "Completed"), sql`${Payments.Amount} - ${Payments.RefundedAmount} >= ${Amount}::numeric`))
    .returning();
  if (!Updated) {
    await ListRefunds(CompanyId, PaymentId);
    throw new AppError(409, "REFUND_TOO_LARGE", "Nothing left to refund");
  }
  const [Entry] = await Db.insert(PaymentRefundLog).values({ PaymentId, Amount, Note: Input.Reason }).returning();
  await Db.update(Orders)
    .set({ Status: "Refunded" })
    .where(and(
      eq(Orders.Id, Updated.OrderId),
      eq(Orders.Status, "Paid"),
      sql`NOT EXISTS (SELECT 1 FROM ${Payments} p WHERE p."OrderId" = ${Updated.OrderId} AND p."Status" = 'Completed' AND p."RefundedAmount" < p."Amount")`,
    ));
  return { Refund: Entry, RefundedAmount: Updated.RefundedAmount, RefundableAmount: FromPiasters(ToPiasters(Updated.Amount) - ToPiasters(Updated.RefundedAmount)) };
}

export async function ListRefunds(CompanyId: number, PaymentId: number) {
  const [Payment] = await Db.select().from(Payments).where(and(eq(Payments.Id, PaymentId), eq(Payments.CompanyId, CompanyId)));
  if (!Payment) throw new AppError(404, "NOT_FOUND", "Payment not found");
  const Items = await Db.select().from(PaymentRefundLog).where(eq(PaymentRefundLog.PaymentId, PaymentId)).orderBy(PaymentRefundLog.Id);
  return { Items, RefundedAmount: Payment.RefundedAmount, RefundableAmount: FromPiasters(ToPiasters(Payment.Amount) - ToPiasters(Payment.RefundedAmount)) };
}
