import { and, asc, eq, gt, gte, lt, lte, sql } from "drizzle-orm";
import { Db } from "../../Database/Db";
import { AttendanceDays, Employees, Leaves, PayrollRuns, Payslips, Users } from "../../Database/Schema";
import { AppError } from "../../Lib/Response";
import { FromPiasters, ToPiasters } from "../../Lib/Money";
import { Now } from "../../Lib/Clock";
import { AddDays, WorkingDays } from "../../Lib/Cairo";
import { MonthRange } from "../Expenses/Expenses.Service";
import { PageMeta } from "../../Lib/Pagination";

export const DoubleOvertimeFrom = "2026-04-15";
const MinutesPerMonth = 30 * 8 * 60;

const SlipFields = {
  UserId: Payslips.UserId,
  Name: Payslips.Name,
  BaseSalary: Payslips.BaseSalary,
  OvertimeMinutes: Payslips.OvertimeMinutes,
  OvertimePay: Payslips.OvertimePay,
  LateMinutes: Payslips.LateMinutes,
  LateDeduction: Payslips.LateDeduction,
  UnpaidLeaveDays: Payslips.UnpaidLeaveDays,
  UnpaidLeaveDeduction: Payslips.UnpaidLeaveDeduction,
  NetPay: Payslips.NetPay,
};

export function ComputePayslip(Salary: number, Minutes: { Late: number; OvertimeAtOneAndHalf: number; OvertimeAtDouble: number }, UnpaidDays: number) {
  const OvertimePay = Math.round((Salary * (Minutes.OvertimeAtOneAndHalf * 3 + Minutes.OvertimeAtDouble * 4)) / (2 * MinutesPerMonth));
  const LateDeduction = Math.round((Salary * Minutes.Late) / MinutesPerMonth);
  const UnpaidLeaveDeduction = Math.round((Salary * UnpaidDays) / 30);
  return { OvertimePay, LateDeduction, UnpaidLeaveDeduction, NetPay: Salary + OvertimePay - LateDeduction - UnpaidLeaveDeduction };
}

export async function RunPayroll(CompanyId: number, Month: string) {
  const { From, To } = MonthRange(Month);
  const LastDay = AddDays(To, -1);
  return Db.transaction(async (Tx) => {
    const [Run] = await Tx.insert(PayrollRuns).values({ CompanyId, Month, CreatedAt: Now() }).onConflictDoNothing().returning();
    if (!Run) throw new AppError(409, "MONTH_ALREADY_PAID", "This month was already paid");
    const People = await Tx.select({ UserId: Users.Id, Name: Users.Name, Salary: Employees.MonthlySalary })
      .from(Employees)
      .innerJoin(Users, eq(Users.Id, Employees.UserId))
      .where(and(eq(Users.CompanyId, CompanyId), gt(Employees.MonthlySalary, "0")))
      .orderBy(asc(Users.Id));
    const Attendance = await Tx.select({
      UserId: AttendanceDays.UserId,
      Late: sql<number>`sum(${AttendanceDays.LateMinutes})::int`,
      Normal: sql<number>`coalesce(sum(${AttendanceDays.OvertimeMinutes}) filter (where ${AttendanceDays.Date} < ${DoubleOvertimeFrom}), 0)::int`,
      Double: sql<number>`coalesce(sum(${AttendanceDays.OvertimeMinutes}) filter (where ${AttendanceDays.Date} >= ${DoubleOvertimeFrom}), 0)::int`,
    })
      .from(AttendanceDays)
      .where(and(eq(AttendanceDays.CompanyId, CompanyId), gte(AttendanceDays.Date, From), lt(AttendanceDays.Date, To)))
      .groupBy(AttendanceDays.UserId);
    const Unpaid = await Tx.select({ UserId: Leaves.UserId, FromDate: Leaves.FromDate, ToDate: Leaves.ToDate })
      .from(Leaves)
      .where(and(eq(Leaves.CompanyId, CompanyId), eq(Leaves.Type, "Unpaid"), eq(Leaves.Status, "Active"), lte(Leaves.FromDate, LastDay), gte(Leaves.ToDate, From)));
    const ByUser = new Map(Attendance.map((A) => [A.UserId, A]));
    const UnpaidDays = new Map<number, number>();
    for (const L of Unpaid) {
      const Days = WorkingDays(L.FromDate < From ? From : L.FromDate, L.ToDate > LastDay ? LastDay : L.ToDate);
      UnpaidDays.set(L.UserId, (UnpaidDays.get(L.UserId) ?? 0) + Days);
    }
    const Rows = People.map((P) => {
      const Salary = ToPiasters(P.Salary);
      const A = ByUser.get(P.UserId);
      const Minutes = { Late: A?.Late ?? 0, OvertimeAtOneAndHalf: A?.Normal ?? 0, OvertimeAtDouble: A?.Double ?? 0 };
      const Days = UnpaidDays.get(P.UserId) ?? 0;
      const Slip = ComputePayslip(Salary, Minutes, Days);
      return {
        RunId: Run.Id,
        CompanyId,
        UserId: P.UserId,
        Name: P.Name,
        BaseSalary: FromPiasters(Salary),
        OvertimeMinutes: Minutes.OvertimeAtOneAndHalf + Minutes.OvertimeAtDouble,
        OvertimePay: FromPiasters(Slip.OvertimePay),
        LateMinutes: Minutes.Late,
        LateDeduction: FromPiasters(Slip.LateDeduction),
        UnpaidLeaveDays: Days,
        UnpaidLeaveDeduction: FromPiasters(Slip.UnpaidLeaveDeduction),
        NetPay: FromPiasters(Slip.NetPay),
      };
    });
    const Inserted = Rows.length ? await Tx.insert(Payslips).values(Rows).returning(SlipFields) : [];
    return { Id: Run.Id, Month, Status: Run.Status, Payslips: Inserted };
  });
}

async function LiveRun(CompanyId: number, Month: string) {
  const [Run] = await Db.select({ Id: PayrollRuns.Id })
    .from(PayrollRuns)
    .where(and(eq(PayrollRuns.CompanyId, CompanyId), eq(PayrollRuns.Month, Month), eq(PayrollRuns.Status, "Paid")));
  if (!Run) throw new AppError(404, "NOT_FOUND", "This month was not paid");
  return Run;
}

export async function ListPayslips(CompanyId: number, Month: string, Page: number, PageSize: number) {
  const Run = await LiveRun(CompanyId, Month);
  const [Totals] = await Db.select({ Total: sql<number>`count(*)::int`, TotalNetPay: sql<string>`coalesce(sum(${Payslips.NetPay}), 0)::numeric(14,2)::text` })
    .from(Payslips)
    .where(eq(Payslips.RunId, Run.Id));
  const Items = await Db.select(SlipFields)
    .from(Payslips)
    .where(eq(Payslips.RunId, Run.Id))
    .orderBy(asc(Payslips.Name), asc(Payslips.UserId))
    .limit(PageSize)
    .offset((Page - 1) * PageSize);
  return { RunId: Run.Id, Month, Items, ...PageMeta(Page, PageSize, Totals.Total), TotalNetPay: Totals.TotalNetPay };
}

export async function MyPayslip(CompanyId: number, UserId: number, Month: string) {
  const Run = await LiveRun(CompanyId, Month);
  const [Slip] = await Db.select(SlipFields).from(Payslips).where(and(eq(Payslips.RunId, Run.Id), eq(Payslips.UserId, UserId)));
  if (!Slip) throw new AppError(404, "NOT_FOUND", "No payslip for this month");
  return { Month, ...Slip };
}

export async function VoidRun(CompanyId: number, Id: number) {
  const [Row] = await Db.update(PayrollRuns)
    .set({ Status: "Voided", VoidedAt: Now() })
    .where(and(eq(PayrollRuns.Id, Id), eq(PayrollRuns.CompanyId, CompanyId), eq(PayrollRuns.Status, "Paid")))
    .returning({ Id: PayrollRuns.Id, Month: PayrollRuns.Month, Status: PayrollRuns.Status });
  if (Row) return Row;
  const [Existing] = await Db.select({ Id: PayrollRuns.Id }).from(PayrollRuns).where(and(eq(PayrollRuns.Id, Id), eq(PayrollRuns.CompanyId, CompanyId)));
  if (!Existing) throw new AppError(404, "NOT_FOUND", "Payroll run not found");
  throw new AppError(409, "ALREADY_VOIDED", "Payroll run already voided");
}
