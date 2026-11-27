import { and, eq, gte, lte, sql } from "drizzle-orm";
import { Db, type Transaction } from "../../Database/Db";
import { Leaves, PayrollRuns } from "../../Database/Schema";
import { AppError } from "../../Lib/Response";
import { Now } from "../../Lib/Clock";
import { WorkingDays } from "../../Lib/Cairo";
import { FindEmployee } from "../Employees/Employees.Service";

export const AnnualEntitlement = 21;

const PublicFields = {
  Id: Leaves.Id,
  UserId: Leaves.UserId,
  Type: Leaves.Type,
  From: Leaves.FromDate,
  To: Leaves.ToDate,
  Days: Leaves.Days,
  Status: Leaves.Status,
};

async function UsedAnnualDays(Executor: Transaction | typeof Db, UserId: number) {
  const [Row] = await Executor.select({ Used: sql<number>`coalesce(sum(${Leaves.Days}), 0)::int` })
    .from(Leaves)
    .where(and(eq(Leaves.UserId, UserId), eq(Leaves.Type, "Annual"), eq(Leaves.Status, "Active")));
  return Row.Used;
}

export async function CreateLeave(CompanyId: number, UserId: number, Input: { Type: "Annual" | "Unpaid"; From: string; To: string }) {
  const Days = WorkingDays(Input.From, Input.To);
  if (Days === 0) throw new AppError(400, "VALIDATION_ERROR", "Leave has no working days");
  return Db.transaction(async (Tx) => {
    await FindEmployee(Tx, CompanyId, UserId);
    await Tx.execute(sql`SELECT pg_advisory_xact_lock(${UserId})`);
    const [Overlap] = await Tx.select({ Id: Leaves.Id })
      .from(Leaves)
      .where(and(eq(Leaves.UserId, UserId), eq(Leaves.Status, "Active"), lte(Leaves.FromDate, Input.To), gte(Leaves.ToDate, Input.From)));
    if (Overlap) throw new AppError(409, "LEAVE_OVERLAP", "Employee already has a leave on one of these days");
    if (Input.Type === "Annual" && (await UsedAnnualDays(Tx, UserId)) + Days > AnnualEntitlement)
      throw new AppError(409, "INSUFFICIENT_BALANCE", "Not enough leave balance");
    const [Row] = await Tx.insert(Leaves)
      .values({ CompanyId, UserId, Type: Input.Type, FromDate: Input.From, ToDate: Input.To, Days })
      .returning(PublicFields);
    return Row;
  });
}

export async function LeaveBalance(CompanyId: number, UserId: number) {
  await FindEmployee(Db, CompanyId, UserId);
  const Used = await UsedAnnualDays(Db, UserId);
  return { UserId, Entitled: AnnualEntitlement, Used, Remaining: AnnualEntitlement - Used };
}

export async function CancelLeave(CompanyId: number, Id: number) {
  return Db.transaction(async (Tx) => {
    const [Leave] = await Tx.select().from(Leaves).where(and(eq(Leaves.Id, Id), eq(Leaves.CompanyId, CompanyId))).for("update");
    if (!Leave) throw new AppError(404, "NOT_FOUND", "Leave not found");
    if (Leave.Status !== "Active") throw new AppError(409, "ALREADY_CANCELLED", "Leave already cancelled");
    const [Paid] = await Tx.select({ Id: PayrollRuns.Id })
      .from(PayrollRuns)
      .where(
        and(
          eq(PayrollRuns.CompanyId, CompanyId),
          eq(PayrollRuns.Status, "Paid"),
          gte(PayrollRuns.Month, Leave.FromDate.slice(0, 7)),
          lte(PayrollRuns.Month, Leave.ToDate.slice(0, 7)),
        ),
      );
    if (Paid) throw new AppError(409, "MONTH_PAID", "Leave touches a month that was already paid");
    const [Row] = await Tx.update(Leaves)
      .set({ Status: "Cancelled", CancelledAt: Now() })
      .where(and(eq(Leaves.Id, Id), eq(Leaves.Status, "Active")))
      .returning(PublicFields);
    if (!Row) throw new AppError(409, "ALREADY_CANCELLED", "Leave already cancelled");
    return Row;
  });
}
