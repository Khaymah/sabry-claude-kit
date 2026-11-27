import { and, eq, sql } from "drizzle-orm";
import { Db } from "../../Database/Db";
import { Orders, Payments } from "../../Database/Schema";
import { AppError } from "../../Lib/Response";
import { FromPiasters, ToPiasters } from "../../Lib/Money";
import type { AuthContext } from "../../Middleware/Auth";
import { OrderScope } from "../Orders/Orders.Service";

export async function CreatePayment(Auth: AuthContext, Input: { OrderId: number; Amount: string; Method: string }) {
  const Amount = ToPiasters(Input.Amount);
  if (Amount <= 0) throw new AppError(400, "VALIDATION_ERROR", "Amount must be positive");
  return Db.transaction(async (Tx) => {
    const CompanyId = Auth.CompanyId;
    const [Order] = await Tx.select().from(Orders).where(OrderScope(Auth, Input.OrderId)).for("update");
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

export async function ListPayments(Auth: AuthContext, OrderId: number) {
  return Db.select({ Payment: Payments })
    .from(Payments)
    .innerJoin(Orders, eq(Orders.Id, Payments.OrderId))
    .where(and(eq(Payments.CompanyId, Auth.CompanyId), OrderScope(Auth, OrderId)))
    .orderBy(Payments.Id)
    .then((Rows) => Rows.map((R) => R.Payment));
}
