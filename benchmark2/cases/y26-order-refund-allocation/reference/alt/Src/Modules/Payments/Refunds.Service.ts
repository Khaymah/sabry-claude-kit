import { and, desc, eq, sql } from "drizzle-orm";
import { Db } from "../../Database/Db";
import { Orders, Payments, RefundAllocations, Refunds } from "../../Database/Schema";
import { AppError } from "../../Lib/Response";
import { FromPiasters, ToPiasters } from "../../Lib/Money";

export async function RefundOrder(CompanyId: number, OrderId: number, Input: { Amount: string; Reason?: string }) {
  const Amount = ToPiasters(Input.Amount);
  if (Amount <= 0) throw new AppError(400, "VALIDATION_ERROR", "Amount must be positive");
  return Db.transaction(async (Tx) => {
    const [Order] = await Tx.select().from(Orders).where(and(eq(Orders.Id, OrderId), eq(Orders.CompanyId, CompanyId))).for("update");
    if (!Order) throw new AppError(404, "NOT_FOUND", "Order not found");
    const Lines = await Tx.select({
      PaymentId: Payments.Id,
      Paid: Payments.Amount,
      Back: sql<string>`coalesce((SELECT sum(a."Amount") FROM ${RefundAllocations} a WHERE a."PaymentId" = "Payments"."Id"), 0)::text`,
    })
      .from(Payments)
      .where(and(eq(Payments.OrderId, OrderId), eq(Payments.Status, "Completed")))
      .orderBy(desc(Payments.CreatedAt), desc(Payments.Id));
    const Left = Lines.map((L) => ({ PaymentId: L.PaymentId, Left: ToPiasters(L.Paid) - ToPiasters(L.Back) }));
    const Available = Left.reduce((S, L) => S + L.Left, 0);
    if (Amount > Available) throw new AppError(409, "REFUND_TOO_LARGE", "Amount exceeds what can be refunded");
    const [Refund] = await Tx.insert(Refunds).values({ CompanyId, OrderId, Amount: FromPiasters(Amount), Reason: Input.Reason }).returning();
    const Allocations: { PaymentId: number; Amount: string }[] = [];
    let Rest = Amount;
    for (const L of Left) {
      const Take = Math.min(Rest, L.Left);
      if (Take <= 0) continue;
      Allocations.push({ PaymentId: L.PaymentId, Amount: FromPiasters(Take) });
      Rest -= Take;
      if (Rest === 0) break;
    }
    await Tx.insert(RefundAllocations).values(Allocations.map((A) => ({ RefundId: Refund.Id, ...A })));
    const PaidTotal = Lines.reduce((S, L) => S + ToPiasters(L.Paid), 0);
    const Remaining = Available - Amount;
    if (Remaining === 0) await Tx.update(Orders).set({ Status: "Refunded" }).where(eq(Orders.Id, OrderId));
    return { RefundId: Refund.Id, Allocations, RefundedAmount: FromPiasters(PaidTotal - Remaining), RefundableAmount: FromPiasters(Remaining) };
  });
}

export async function ListOrderRefunds(CompanyId: number, OrderId: number) {
  const [Order] = await Db.select().from(Orders).where(and(eq(Orders.Id, OrderId), eq(Orders.CompanyId, CompanyId)));
  if (!Order) throw new AppError(404, "NOT_FOUND", "Order not found");
  const Items = await Db.select().from(Refunds).where(eq(Refunds.OrderId, OrderId)).orderBy(Refunds.Id);
  const [Paid] = await Db.select({ S: sql<string>`coalesce(sum(${Payments.Amount}), 0)::text` }).from(Payments).where(and(eq(Payments.OrderId, OrderId), eq(Payments.Status, "Completed")));
  const Back = Items.reduce((S, R) => S + ToPiasters(R.Amount), 0);
  return { Items, RefundedAmount: FromPiasters(Back), RefundableAmount: FromPiasters(ToPiasters(Paid.S) - Back) };
}
