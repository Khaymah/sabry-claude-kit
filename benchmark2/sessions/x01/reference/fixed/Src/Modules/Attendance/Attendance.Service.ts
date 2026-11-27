import { and, asc, eq, gte, isNull, lt } from "drizzle-orm";
import { Db } from "../../Database/Db";
import { AttendanceDays } from "../../Database/Schema";
import { AppError } from "../../Lib/Response";
import { Now } from "../../Lib/Clock";
import { AddDays, CairoDate, CairoInstant } from "../../Lib/Cairo";
import { MonthRange } from "../Expenses/Expenses.Service";
import { FindEmployee } from "../Employees/Employees.Service";

const Quarter = 15;
const MinuteMs = 60_000;

export const RoundLateMinutes = (Minutes: number) => (Minutes <= 0 ? 0 : Math.ceil(Minutes / Quarter) * Quarter);
export const RoundOvertimeMinutes = (Minutes: number) => (Minutes <= 0 ? 0 : Math.floor(Minutes / Quarter) * Quarter);

const PublicFields = {
  Id: AttendanceDays.Id,
  UserId: AttendanceDays.UserId,
  Date: AttendanceDays.Date,
  CheckInAt: AttendanceDays.CheckInAt,
  CheckOutAt: AttendanceDays.CheckOutAt,
  LateMinutes: AttendanceDays.LateMinutes,
  OvertimeMinutes: AttendanceDays.OvertimeMinutes,
};

export async function CheckIn(CompanyId: number, UserId: number) {
  const Employee = await FindEmployee(Db, CompanyId, UserId);
  const At = Now();
  const Day = CairoDate(At);
  const ShiftStartAt = CairoInstant(Day, Employee.ShiftStart);
  const EndDay = Employee.ShiftEnd <= Employee.ShiftStart ? AddDays(Day, 1) : Day;
  const ShiftEndAt = CairoInstant(EndDay, Employee.ShiftEnd);
  const LateMinutes = RoundLateMinutes(Math.floor((At.getTime() - ShiftStartAt.getTime()) / MinuteMs));
  const [Row] = await Db.insert(AttendanceDays)
    .values({ CompanyId, UserId, Date: Day, CheckInAt: At, ShiftStartAt, ShiftEndAt, LateMinutes })
    .onConflictDoNothing()
    .returning(PublicFields);
  if (!Row) throw new AppError(409, "ALREADY_CHECKED_IN", "Already checked in today or still checked in");
  return Row;
}

export async function CheckOut(CompanyId: number, UserId: number) {
  const At = Now();
  return Db.transaction(async (Tx) => {
    const [Open] = await Tx.select({ Id: AttendanceDays.Id, ShiftEndAt: AttendanceDays.ShiftEndAt })
      .from(AttendanceDays)
      .where(and(eq(AttendanceDays.UserId, UserId), eq(AttendanceDays.CompanyId, CompanyId), isNull(AttendanceDays.CheckOutAt)))
      .for("update");
    if (!Open) throw new AppError(409, "NOT_CHECKED_IN", "No open check-in");
    const OvertimeMinutes = RoundOvertimeMinutes(Math.floor((At.getTime() - Open.ShiftEndAt.getTime()) / MinuteMs));
    const [Row] = await Tx.update(AttendanceDays)
      .set({ CheckOutAt: At, OvertimeMinutes })
      .where(and(eq(AttendanceDays.Id, Open.Id), isNull(AttendanceDays.CheckOutAt)))
      .returning(PublicFields);
    if (!Row) throw new AppError(409, "NOT_CHECKED_IN", "No open check-in");
    return Row;
  });
}

export async function ListAttendance(CompanyId: number, UserId: number, Month: string) {
  await FindEmployee(Db, CompanyId, UserId);
  const { From, To } = MonthRange(Month);
  const Items = await Db.select(PublicFields)
    .from(AttendanceDays)
    .where(and(eq(AttendanceDays.UserId, UserId), eq(AttendanceDays.CompanyId, CompanyId), gte(AttendanceDays.Date, From), lt(AttendanceDays.Date, To)))
    .orderBy(asc(AttendanceDays.Date));
  return { UserId, Month, Items };
}
