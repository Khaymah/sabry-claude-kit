import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import { Db, type Transaction } from "../../Database/Db";
import { CashOuts, Payments, Shifts } from "../../Database/Schema";
import { AppError } from "../../Lib/Response";
import { Now } from "../../Lib/Clock";
import { FromPiasters, ToPiasters } from "../../Lib/Money";
import { PageMeta } from "../../Lib/Pagination";

async function Expected(Tx: Transaction, Shift: typeof Shifts.$inferSelect) {
  const [{ In }] = await Tx.select({ In: sql<string>`coalesce(sum(${Payments.Amount}), 0)::text` })
    .from(Payments)
    .where(and(eq(Payments.ShiftId, Shift.Id), eq(Payments.Method, "Cash"), eq(Payments.Status, "Completed")));
  const [{ Out }] = await Tx.select({ Out: sql<string>`coalesce(sum(${CashOuts.Amount}), 0)::text` }).from(CashOuts).where(eq(CashOuts.ShiftId, Shift.Id));
  return ToPiasters(Shift.OpeningCash) + ToPiasters(In) - ToPiasters(Out);
}

async function Lock(Tx: Transaction, CompanyId: number, Id: number) {
  const [Shift] = await Tx.select().from(Shifts).where(and(eq(Shifts.Id, Id), eq(Shifts.CompanyId, CompanyId))).for("update");
  if (!Shift) throw new AppError(404, "NOT_FOUND", "Shift not found");
  return Shift;
}

export async function OpenShift(CompanyId: number, UserId: number, OpeningCash: string) {
  return Db.transaction(async (Tx) => {
    const [Open] = await Tx.select({ Id: Shifts.Id }).from(Shifts).where(and(eq(Shifts.UserId, UserId), isNull(Shifts.ClosedAt)));
    if (Open) throw new AppError(409, "SHIFT_ALREADY_OPEN", "You already have an open shift");
    const [Shift] = await Tx.insert(Shifts).values({ CompanyId, UserId, OpeningCash: FromPiasters(ToPiasters(OpeningCash)), OpenedAt: Now() }).returning();
    return Shift;
  });
}

async function Close(CompanyId: number, Id: number, CountedCash: string, ByUserId: number | null) {
  return Db.transaction(async (Tx) => {
    const Shift = await Lock(Tx, CompanyId, Id);
    if (ByUserId !== null && Shift.UserId !== ByUserId) throw new AppError(403, "FORBIDDEN", "Not your shift");
    if (Shift.ClosedAt) throw new AppError(409, "SHIFT_CLOSED", "Shift is already closed");
    const Want = await Expected(Tx, Shift);
    const Counted = ToPiasters(CountedCash);
    const [Done] = await Tx.update(Shifts)
      .set({ ClosedAt: Now(), CountedCash: FromPiasters(Counted), ExpectedCash: FromPiasters(Want) })
      .where(eq(Shifts.Id, Id))
      .returning();
    return { ...Done, Difference: FromPiasters(Counted - Want) };
  });
}

export const CloseShift = (CompanyId: number, UserId: number, Id: number, CountedCash: string) => Close(CompanyId, Id, CountedCash, UserId);
export const ForceClose = (CompanyId: number, Id: number, CountedCash: string) => Close(CompanyId, Id, CountedCash, null);

export async function CashOut(CompanyId: number, UserId: number, Id: number, Amount: string, Reason: string) {
  const Piasters = ToPiasters(Amount);
  if (Piasters <= 0) throw new AppError(400, "VALIDATION_ERROR", "Amount must be positive");
  return Db.transaction(async (Tx) => {
    const Shift = await Lock(Tx, CompanyId, Id);
    if (Shift.UserId !== UserId) throw new AppError(403, "FORBIDDEN", "Not your shift");
    if (Shift.ClosedAt) throw new AppError(409, "SHIFT_CLOSED", "Shift is closed");
    if (Piasters > (await Expected(Tx, Shift))) throw new AppError(409, "NOT_ENOUGH_CASH", "Not enough cash in the drawer");
    const [Row] = await Tx.insert(CashOuts).values({ ShiftId: Id, Amount: FromPiasters(Piasters), Reason, CreatedAt: Now() }).returning();
    return Row;
  });
}

export async function ListShifts(CompanyId: number, Page: number, PageSize: number, UserId?: number) {
  const Where = UserId ? and(eq(Shifts.CompanyId, CompanyId), eq(Shifts.UserId, UserId)) : eq(Shifts.CompanyId, CompanyId);
  const Items = await Db.select().from(Shifts).where(Where).orderBy(desc(Shifts.OpenedAt), desc(Shifts.Id)).limit(PageSize).offset((Page - 1) * PageSize);
  const [{ Total }] = await Db.select({ Total: count() }).from(Shifts).where(Where);
  return { Items, ...PageMeta(Page, PageSize, Total) };
}
