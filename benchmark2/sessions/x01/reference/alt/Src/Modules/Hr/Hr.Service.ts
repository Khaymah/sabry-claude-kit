import { sql, type SQL } from "drizzle-orm";
import { Db, type Transaction } from "../../Database/Db";
import { AppError } from "../../Lib/Response";
import { Now } from "../../Lib/Clock";

type Executor = Transaction | typeof Db;

export async function Rows<T>(Executor: Executor, Query: SQL) {
  return (await Executor.execute(Query)).rows as T[];
}

export const Entitlement = 21;

async function LockEmployee(Tx: Executor, CompanyId: number, UserId: number) {
  const [Row] = await Rows<{ ShiftStart: string; ShiftEnd: string; AnnualLeaveLeft: number }>(
    Tx,
    sql`SELECT "ShiftStart", "ShiftEnd", "AnnualLeaveLeft" FROM "Users" WHERE "Id" = ${UserId} AND "CompanyId" = ${CompanyId} FOR UPDATE`,
  );
  if (!Row) throw new AppError(404, "NOT_FOUND", "Employee not found");
  return Row;
}

const EmployeeColumns = sql`"Id" AS "UserId", "Name", "MonthlySalary"::text AS "MonthlySalary", "ShiftStart", "ShiftEnd"`;

export async function ListEmployees(CompanyId: number) {
  return { Items: await Rows(Db, sql`SELECT ${EmployeeColumns} FROM "Users" WHERE "CompanyId" = ${CompanyId} ORDER BY "Name", "Id"`) };
}

export async function SaveEmployee(CompanyId: number, UserId: number, Input: { MonthlySalary: string; ShiftStart: string; ShiftEnd: string }) {
  const [Row] = await Rows(
    Db,
    sql`UPDATE "Users" SET "MonthlySalary" = ${Input.MonthlySalary}::numeric, "ShiftStart" = ${Input.ShiftStart}, "ShiftEnd" = ${Input.ShiftEnd}
        WHERE "Id" = ${UserId} AND "CompanyId" = ${CompanyId} RETURNING ${EmployeeColumns}`,
  );
  if (!Row) throw new AppError(404, "NOT_FOUND", "Employee not found");
  return Row;
}

const PunchColumns = sql`"Id", "UserId", "WorkDay"::text AS "Date", "InAt" AS "CheckInAt", "OutAt" AS "CheckOutAt", "LateMinutes", "OvertimeMinutes"`;

async function PunchView(Tx: Executor, Id: number) {
  const [Row] = await Rows(Tx, sql`SELECT ${PunchColumns} FROM "PunchMinutes" WHERE "Id" = ${Id}`);
  return Row;
}

export async function PunchIn(CompanyId: number, UserId: number) {
  const At = Now().toISOString();
  return Db.transaction(async (Tx) => {
    const Employee = await LockEmployee(Tx, CompanyId, UserId);
    const [Busy] = await Rows(
      Tx,
      sql`SELECT 1 FROM "Punches" WHERE "UserId" = ${UserId}
          AND ("OutAt" IS NULL OR "WorkDay" = (${At}::timestamptz AT TIME ZONE 'Africa/Cairo')::date)`,
    );
    if (Busy) throw new AppError(409, "ALREADY_IN", "Already checked in today");
    const [Created] = await Rows<{ Id: number }>(
      Tx,
      sql`INSERT INTO "Punches" ("CompanyId", "UserId", "WorkDay", "InAt", "ShiftStart", "ShiftEnd")
          VALUES (${CompanyId}, ${UserId}, (${At}::timestamptz AT TIME ZONE 'Africa/Cairo')::date, ${At}::timestamptz, ${Employee.ShiftStart}, ${Employee.ShiftEnd})
          RETURNING "Id"`,
    );
    return PunchView(Tx, Created.Id);
  });
}

export async function PunchOut(CompanyId: number, UserId: number) {
  const At = Now().toISOString();
  return Db.transaction(async (Tx) => {
    await LockEmployee(Tx, CompanyId, UserId);
    const [Open] = await Rows<{ Id: number }>(
      Tx,
      sql`UPDATE "Punches" SET "OutAt" = ${At}::timestamptz WHERE "UserId" = ${UserId} AND "OutAt" IS NULL RETURNING "Id"`,
    );
    if (!Open) throw new AppError(409, "NOT_IN", "Not checked in");
    return PunchView(Tx, Open.Id);
  });
}

export async function MonthPunches(CompanyId: number, UserId: number, Month: string) {
  await LockEmployee(Db, CompanyId, UserId);
  const Items = await Rows(
    Db,
    sql`SELECT ${PunchColumns} FROM "PunchMinutes" WHERE "UserId" = ${UserId} AND to_char("WorkDay", 'YYYY-MM') = ${Month} ORDER BY "WorkDay"`,
  );
  return { Items };
}

export async function RequestLeave(CompanyId: number, UserId: number, Input: { Type: string; From: string; To: string }) {
  return Db.transaction(async (Tx) => {
    await LockEmployee(Tx, CompanyId, UserId);
    const [Count] = await Rows<{ Days: number }>(
      Tx,
      sql`SELECT count(*)::int AS "Days" FROM generate_series(${Input.From}::date, ${Input.To}::date, interval '1 day') D WHERE extract(isodow FROM D) <> 5`,
    );
    if (Count.Days === 0) throw new AppError(400, "VALIDATION_ERROR", "No working days in this range");
    const [Clash] = await Rows(
      Tx,
      sql`SELECT 1 FROM "LeaveRequests" WHERE "UserId" = ${UserId} AND "CancelledAt" IS NULL
          AND "FirstDay" <= ${Input.To}::date AND "LastDay" >= ${Input.From}::date`,
    );
    if (Clash) throw new AppError(409, "OVERLAP", "Overlapping leave");
    if (Input.Type === "Annual") {
      const [Left] = await Rows(
        Tx,
        sql`UPDATE "Users" SET "AnnualLeaveLeft" = "AnnualLeaveLeft" - ${Count.Days} WHERE "Id" = ${UserId} AND "AnnualLeaveLeft" >= ${Count.Days} RETURNING 1`,
      );
      if (!Left) throw new AppError(409, "NO_BALANCE", "Not enough leave balance");
    }
    const [Row] = await Rows(
      Tx,
      sql`INSERT INTO "LeaveRequests" ("CompanyId", "UserId", "Kind", "FirstDay", "LastDay", "DayCount")
          VALUES (${CompanyId}, ${UserId}, ${Input.Type}, ${Input.From}::date, ${Input.To}::date, ${Count.Days})
          RETURNING "Id", "UserId", "Kind" AS "Type", "FirstDay"::text AS "From", "LastDay"::text AS "To", "DayCount" AS "Days"`,
    );
    return Row;
  });
}

export async function LeaveBalance(CompanyId: number, UserId: number) {
  const Employee = await LockEmployee(Db, CompanyId, UserId);
  return { Entitled: Entitlement, Used: Entitlement - Employee.AnnualLeaveLeft, Remaining: Employee.AnnualLeaveLeft };
}

export async function CancelLeave(CompanyId: number, Id: number) {
  return Db.transaction(async (Tx) => {
    const [Leave] = await Rows<{ UserId: number; Kind: string; DayCount: number; CancelledAt: string | null; FirstMonth: string; LastMonth: string }>(
      Tx,
      sql`SELECT "UserId", "Kind", "DayCount", "CancelledAt", to_char("FirstDay", 'YYYY-MM') AS "FirstMonth", to_char("LastDay", 'YYYY-MM') AS "LastMonth"
          FROM "LeaveRequests" WHERE "Id" = ${Id} AND "CompanyId" = ${CompanyId} FOR UPDATE`,
    );
    if (!Leave) throw new AppError(404, "NOT_FOUND", "Leave not found");
    if (Leave.CancelledAt) throw new AppError(409, "ALREADY_CANCELLED", "Leave already cancelled");
    const [Paid] = await Rows(
      Tx,
      sql`SELECT 1 FROM "PayrollMonths" WHERE "CompanyId" = ${CompanyId} AND "LiveRunId" IS NOT NULL AND "Month" BETWEEN ${Leave.FirstMonth} AND ${Leave.LastMonth}`,
    );
    if (Paid) throw new AppError(409, "MONTH_PAID", "Leave falls in a paid month");
    await Tx.execute(sql`UPDATE "LeaveRequests" SET "CancelledAt" = ${Now().toISOString()}::timestamptz WHERE "Id" = ${Id}`);
    if (Leave.Kind === "Annual")
      await Tx.execute(sql`UPDATE "Users" SET "AnnualLeaveLeft" = "AnnualLeaveLeft" + ${Leave.DayCount} WHERE "Id" = ${Leave.UserId}`);
    return { Id, Status: "Cancelled" };
  });
}
