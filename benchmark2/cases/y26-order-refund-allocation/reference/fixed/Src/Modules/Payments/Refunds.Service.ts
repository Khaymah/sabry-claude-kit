import { and, desc, eq, inArray } from "drizzle-orm";
import { Db, type Transaction } from "../../Database/Db";
import { Orders, Payments, Refunds } from "../../Database/Schema";
import { AppError } from "../../Lib/Response";
import { FromPiasters, ToPiasters } from "../../Lib/Money";

async function Ledger(Tx: Transaction | typeof Db, CompanyId: number, OrderId: number) {
  const [Order] = await Tx.select().from(Orders).where(and(eq(Orders.Id, OrderId), eq(Orders.CompanyId, CompanyId)));
  if (!Order) throw new AppError(404, "NOT_FOUND", "Order not found");
  const Paid = await Tx.select().from(Payments).where(and(eq(Payments.OrderId, OrderId), eq(Payments.Status, "Completed"))).orderBy(desc(Payments.Id));
  const Back = Paid.length ? await Tx.select().from(Refunds).where(inArray(Refunds.PaymentId, Paid.map((P) => P.Id))).orderBy(Refunds.Id) : [];
  const Lines = Paid.map((P) => {
    const Refunded = Back.filter((R) => R.PaymentId === P.Id).reduce((S, R) => S + ToPiasters(R.Amount), 0);
    return { PaymentId: P.Id, Left: ToPiasters(P.Amount) - Refunded };
  });
  const PaidTotal = Paid.reduce((S, P) => S + ToPiasters(P.Amount), 0);
  const RefundedTotal = Back.reduce((S, R) => S + ToPiasters(R.Amount), 0);
  return { Order, Lines, Back, PaidTotal, RefundedTotal };
}

export async function RefundOrder(CompanyId: number, OrderId: number, Input: { Amount: string; Reason?: string }) {
  const Amount = ToPiasters(Input.Amount);
  if (Amount <= 0) throw new AppError(400, "VALIDATION_ERROR", "Amount must be positive");
  return Db.transaction(async (Tx) => {
    const { Lines, PaidTotal, RefundedTotal } = await Ledger(Tx, CompanyId, OrderId);
    if (Amount > PaidTotal - RefundedTotal) throw new AppError(409, "REFUND_EXCEEDS_PAID", "Amount exceeds what is left to refund");
    let Rest = Amount;
    const Allocations: { PaymentId: number; Amount: string }[] = [];
    for (const Line of Lines) {
      if (Rest === 0) break;
      const Take = Math.min(Rest, Line.Left);
      if (Take <= 0) continue;
      await Tx.insert(Refunds).values({ CompanyId, PaymentId: Line.PaymentId, Amount: FromPiasters(Take), Reason: Input.Reason });
      Allocations.push({ PaymentId: Line.PaymentId, Amount: FromPiasters(Take) });
      Rest -= Take;
    }
    const Refunded = RefundedTotal + Amount;
    if (Refunded === PaidTotal) await Tx.update(Orders).set({ Status: "Refunded" }).where(eq(Orders.Id, OrderId));
    return { Allocations, RefundedAmount: FromPiasters(Refunded), RefundableAmount: FromPiasters(PaidTotal - Refunded) };
  });
}

export async function ListOrderRefunds(CompanyId: number, OrderId: number) {
  const { Back, PaidTotal, RefundedTotal } = await Ledger(Db, CompanyId, OrderId);
  return {
    Items: Back.map((R) => ({ Id: R.Id, PaymentId: R.PaymentId, Amount: R.Amount, Reason: R.Reason, CreatedAt: R.CreatedAt })),
    RefundedAmount: FromPiasters(RefundedTotal),
    RefundableAmount: FromPiasters(PaidTotal - RefundedTotal),
  };
}
