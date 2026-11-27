import { sql } from "drizzle-orm";
import { Db } from "../../Database/Db";
import { AppError } from "../../Lib/Response";
import { FromPiasters, ToPiasters } from "../../Lib/Money";
import { Now } from "../../Lib/Clock";
import { Rows } from "./Hr.Service";

const OvertimeChange = { From: "2026-04-15", Before: 1.5, After: 2 };

type Line = {
  UserId: number;
  Name: string;
  BaseSalary: string;
  OvertimePay: string;
  LateDeduction: string;
  UnpaidLeaveDeduction: string;
  NetPay: string;
};

type Source = { UserId: number; Name: string; Salary: string; Late: number; OvertimeBefore: number; OvertimeAfter: number; UnpaidDays: number };

function Cents(Value: number) {
  return Math.round(Value);
}

function BuildLine(S: Source): Line {
  const Salary = ToPiasters(S.Salary);
  const PerMinute = Salary / (30 * 8 * 60);
  const Overtime = Cents(PerMinute * (S.OvertimeBefore * OvertimeChange.Before + S.OvertimeAfter * OvertimeChange.After));
  const Late = Cents(PerMinute * S.Late);
  const Unpaid = Cents((Salary / 30) * S.UnpaidDays);
  return {
    UserId: S.UserId,
    Name: S.Name,
    BaseSalary: FromPiasters(Salary),
    OvertimePay: FromPiasters(Overtime),
    LateDeduction: FromPiasters(Late),
    UnpaidLeaveDeduction: FromPiasters(Unpaid),
    NetPay: FromPiasters(Salary + Overtime - Late - Unpaid),
  };
}

export async function PayMonth(CompanyId: number, Month: string) {
  return Db.transaction(async (Tx) => {
    const [Run] = await Rows<{ Id: number }>(
      Tx,
      sql`INSERT INTO "PayrollRuns" ("CompanyId", "Month", "CreatedAt") VALUES (${CompanyId}, ${Month}, ${Now().toISOString()}::timestamptz) RETURNING "Id"`,
    );
    const [Claimed] = await Rows(
      Tx,
      sql`INSERT INTO "PayrollMonths" ("CompanyId", "Month", "LiveRunId") VALUES (${CompanyId}, ${Month}, ${Run.Id})
          ON CONFLICT ("CompanyId", "Month") DO UPDATE SET "LiveRunId" = EXCLUDED."LiveRunId" WHERE "PayrollMonths"."LiveRunId" IS NULL
          RETURNING 1`,
    );
    if (!Claimed) throw new AppError(409, "ALREADY_PAID", "Month already paid");
    const Start = `${Month}-01`;
    const Sources = await Rows<Source>(
      Tx,
      sql`WITH Bounds AS (SELECT ${Start}::date AS "First", (${Start}::date + interval '1 month' - interval '1 day')::date AS "Last"),
          Punched AS (
            SELECT "UserId", sum("LateMinutes")::int AS "Late",
              coalesce(sum("OvertimeMinutes") FILTER (WHERE "WorkDay" < ${OvertimeChange.From}::date), 0)::int AS "OvertimeBefore",
              coalesce(sum("OvertimeMinutes") FILTER (WHERE "WorkDay" >= ${OvertimeChange.From}::date), 0)::int AS "OvertimeAfter"
            FROM "PunchMinutes", Bounds WHERE "CompanyId" = ${CompanyId} AND "WorkDay" BETWEEN Bounds."First" AND Bounds."Last"
            GROUP BY "UserId"),
          Unpaid AS (
            SELECT L."UserId", count(*)::int AS "Days"
            FROM "LeaveRequests" L, Bounds,
              generate_series(greatest(L."FirstDay", Bounds."First"), least(L."LastDay", Bounds."Last"), interval '1 day') D
            WHERE L."CompanyId" = ${CompanyId} AND L."Kind" = 'Unpaid' AND L."CancelledAt" IS NULL AND extract(isodow FROM D) <> 5
            GROUP BY L."UserId")
          SELECT U."Id" AS "UserId", U."Name", U."MonthlySalary"::text AS "Salary",
            coalesce(P."Late", 0) AS "Late", coalesce(P."OvertimeBefore", 0) AS "OvertimeBefore", coalesce(P."OvertimeAfter", 0) AS "OvertimeAfter",
            coalesce(N."Days", 0) AS "UnpaidDays"
          FROM "Users" U LEFT JOIN Punched P ON P."UserId" = U."Id" LEFT JOIN Unpaid N ON N."UserId" = U."Id"
          WHERE U."CompanyId" = ${CompanyId} AND U."MonthlySalary" > 0
          ORDER BY U."Id"`,
    );
    const Lines = Sources.map(BuildLine);
    await Tx.execute(sql`UPDATE "PayrollRuns" SET "Lines" = ${JSON.stringify(Lines)}::jsonb WHERE "Id" = ${Run.Id}`);
    return { Id: Run.Id, Month, Status: "Paid", Payslips: Lines };
  });
}

export async function VoidPayroll(CompanyId: number, Id: number) {
  return Db.transaction(async (Tx) => {
    const [Row] = await Rows<{ VoidedAt: string | null }>(Tx, sql`SELECT "VoidedAt" FROM "PayrollRuns" WHERE "Id" = ${Id} AND "CompanyId" = ${CompanyId} FOR UPDATE`);
    if (!Row) throw new AppError(404, "NOT_FOUND", "Payroll run not found");
    if (Row.VoidedAt) throw new AppError(409, "ALREADY_VOIDED", "Payroll run already voided");
    await Tx.execute(sql`UPDATE "PayrollRuns" SET "VoidedAt" = ${Now().toISOString()}::timestamptz WHERE "Id" = ${Id}`);
    await Tx.execute(sql`UPDATE "PayrollMonths" SET "LiveRunId" = NULL WHERE "LiveRunId" = ${Id}`);
    return { Id, Status: "Voided" };
  });
}

async function LiveLines(CompanyId: number, Month: string) {
  const [Run] = await Rows<{ Lines: Line[] }>(
    Db,
    sql`SELECT R."Lines" FROM "PayrollMonths" M JOIN "PayrollRuns" R ON R."Id" = M."LiveRunId" WHERE M."CompanyId" = ${CompanyId} AND M."Month" = ${Month}`,
  );
  if (!Run) throw new AppError(404, "NOT_FOUND", "Month not paid");
  return Run.Lines;
}

export async function PayslipList(CompanyId: number, Month: string, Page: number, PageSize: number) {
  const Lines = [...(await LiveLines(CompanyId, Month))].sort((X, Y) => (X.Name < Y.Name ? -1 : X.Name > Y.Name ? 1 : X.UserId - Y.UserId));
  const TotalNetPay = FromPiasters(Lines.reduce((Sum, L) => Sum + ToPiasters(L.NetPay), 0));
  return { Items: Lines.slice((Page - 1) * PageSize, Page * PageSize), Page, PageSize, Total: Lines.length, TotalNetPay };
}

export async function OwnPayslip(CompanyId: number, UserId: number, Month: string) {
  const Line = (await LiveLines(CompanyId, Month)).find((L) => L.UserId === UserId);
  if (!Line) throw new AppError(404, "NOT_FOUND", "No payslip");
  return Line;
}
