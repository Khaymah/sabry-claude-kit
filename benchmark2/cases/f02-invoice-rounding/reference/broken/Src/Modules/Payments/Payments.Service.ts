import { and, eq, sql } from "drizzle-orm";
import { Db } from "../../Database/Db";
import { Orders, Payments } from "../../Database/Schema";
import { AppError } from "../../Lib/Response";

export async function CreatePayment(CompanyId: number, Input: { OrderId: number; Amount: string; Method: string }) {
  const Amount = Number(Input.Amount);
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
    const AlreadyPaid = Number(Paid);
    const OrderTotal = Number(Order.Total);
    if (AlreadyPaid + Amount > OrderTotal) throw new AppError(409, "OVERPAYMENT", "Amount exceeds the remaining balance");
    const [Payment] = await Tx.insert(Payments)
      .values({ CompanyId, OrderId: Order.Id, Amount: Amount.toFixed(2), Method: Input.Method })
      .returning();
    const OrderStatus = AlreadyPaid + Amount === OrderTotal ? "Paid" : "Pending";
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
