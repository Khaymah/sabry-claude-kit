import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import { Db, type Transaction } from "../../Database/Db";
import { DrawerMoves, Shifts } from "../../Database/Schema";
import { AppError } from "../../Lib/Response";
import { FromPiasters, ToPiasters } from "../../Lib/Money";
import { PageMeta } from "../../Lib/Pagination";

async function Drawer(Tx: Transaction, Shift: typeof Shifts.$inferSelect) {
  const Rows = await Tx.execute<{ In: string; Moves: string }>(sql`
    SELECT
      (SELECT coalesce(sum(p."Amount"), 0) FROM "Payments" p
        WHERE p."TakenBy" = ${Shift.UserId} AND p."Method" = 'Cash' AND p."Status" = 'Completed'
          AND p."CreatedAt" >= ${Shift.OpenedAt.toISOString()}::timestamptz
          AND (${Shift.ClosedAt ? Shift.ClosedAt.toISOString() : null}::timestamptz IS NULL OR p."CreatedAt" < ${Shift.ClosedAt ? Shift.ClosedAt.toISOString() : null}::timestamptz))::text AS "In",
      (SELECT coalesce(sum("Change"), 0) FROM "DrawerMoves" WHERE "ShiftId" = ${Shift.Id})::text AS "Moves"
  `);
  return ToPiasters(Shift.OpeningCash) + ToPiasters(Number(Rows.rows[0].In).toFixed(2)) + ToPiasters(Number(Rows.rows[0].Moves).toFixed(2));
}

async function Get(Tx: Transaction, CompanyId: number, Id: number) {
  const [Shift] = await Tx.select().from(Shifts).where(and(eq(Shifts.Id, Id), eq(Shifts.CompanyId, CompanyId))).for("update");
  if (!Shift) throw new AppError(404, "NOT_FOUND", "Shift not found");
  return Shift;
}

export async function OpenShift(CompanyId: number, UserId: number, OpeningCash: string) {
  try {
    const [Shift] = await Db.insert(Shifts).values({ CompanyId, UserId, OpeningCash: FromPiasters(ToPiasters(OpeningCash)) }).returning();
    return Shift;
  } catch (Err) {
    const Cause = (Err as { cause?: { code?: string } }).cause;
    if ((Err as { code?: string }).code === "23505" || Cause?.code === "23505") throw new AppError(409, "SHIFT_ALREADY_OPEN", "You already have an open shift");
    throw Err;
  }
}

async function Close(CompanyId: number, Id: number, CountedCash: string, ByUserId: number | null) {
  return Db.transaction(async (Tx) => {
    const Shift = await Get(Tx, CompanyId, Id);
    if (ByUserId !== null && Shift.UserId !== ByUserId) throw new AppError(404, "NOT_FOUND", "Shift not found");
    if (Shift.ClosedAt) throw new AppError(409, "SHIFT_CLOSED", "Shift is already closed");
    const Want = await Drawer(Tx, Shift);
    const Counted = ToPiasters(CountedCash);
    const [Done] = await Tx.update(Shifts)
      .set({ ClosedAt: sql`clock_timestamp()` as unknown as Date, CountedCash: FromPiasters(Counted), ExpectedCash: FromPiasters(Want) })
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
    const Shift = await Get(Tx, CompanyId, Id);
    if (Shift.UserId !== UserId) throw new AppError(404, "NOT_FOUND", "Shift not found");
    if (Shift.ClosedAt) throw new AppError(409, "SHIFT_CLOSED", "Shift is closed");
    if (Piasters > (await Drawer(Tx, Shift))) throw new AppError(409, "NOT_ENOUGH_CASH", "Not enough cash");
    const [Row] = await Tx.insert(DrawerMoves).values({ ShiftId: Id, Change: FromPiasters(-Piasters), Note: Reason }).returning();
    return Row;
  });
}

export async function ListShifts(CompanyId: number, Page: number, PageSize: number, UserId?: number) {
  const Where = UserId ? and(eq(Shifts.CompanyId, CompanyId), eq(Shifts.UserId, UserId)) : eq(Shifts.CompanyId, CompanyId);
  const Items = await Db.select().from(Shifts).where(Where).orderBy(desc(Shifts.OpenedAt), desc(Shifts.Id)).limit(PageSize).offset((Page - 1) * PageSize);
  const [{ Total }] = await Db.select({ Total: count() }).from(Shifts).where(Where);
  return { Items, ...PageMeta(Page, PageSize, Total) };
}
