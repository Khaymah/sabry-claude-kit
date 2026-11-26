import { and, eq, sql } from "drizzle-orm";
import { Db } from "../../Database/Db";
import { Customers, LoyaltyLedger, Orders, Payments } from "../../Database/Schema";
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
    if (Input.Method === "Wallet") {
      const [Debited] = await Tx.update(Customers)
        .set({ WalletBalance: sql`${Customers.WalletBalance} - ${FromPiasters(Amount)}::numeric` })
        .where(and(eq(Customers.Id, Order.CustomerId), sql`${Customers.WalletBalance} >= ${FromPiasters(Amount)}::numeric`))
        .returning({ Id: Customers.Id });
      if (!Debited) throw new AppError(409, "INSUFFICIENT_BALANCE", "Wallet balance is not enough");
    }
    const [Payment] = await Tx.insert(Payments)
      .values({ CompanyId, OrderId: Order.Id, Amount: FromPiasters(Amount), Method: Input.Method })
      .returning();
    const OrderStatus = Amount === Remaining ? "Paid" : "Pending";
    if (OrderStatus === "Paid") {
      await Tx.update(Orders).set({ Status: "Paid" }).where(eq(Orders.Id, Order.Id));
      const Points = Math.floor(ToPiasters(Order.Total) / 1000);
      if (Points > 0)
        await Tx.insert(LoyaltyLedger).values({ CustomerId: Order.CustomerId, Points, Reason: "Earned", OrderId: Order.Id }).onConflictDoNothing();
    }
    return { ...Payment, OrderStatus };
  });
}

export async function ListPayments(CompanyId: number, OrderId: number) {
  return Db.select()
    .from(Payments)
    .where(and(eq(Payments.CompanyId, CompanyId), eq(Payments.OrderId, OrderId)))
    .orderBy(Payments.Id);
}
