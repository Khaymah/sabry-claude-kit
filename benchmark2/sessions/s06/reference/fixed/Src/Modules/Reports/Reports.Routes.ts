import { Hono } from "hono";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { RequireAuth, type AppEnv } from "../../Middleware/Auth";
import { Db } from "../../Database/Db";
import { Ok } from "../../Lib/Response";
import { ParseQuery } from "../../Lib/Validate";
import { FromPiasters, ToPiasters } from "../../Lib/Money";

export const ReportsRoutes = new Hono<AppEnv>();
ReportsRoutes.use("*", RequireAuth);

ReportsRoutes.get("/Cash", async (C) => {
  const { Date: Day } = ParseQuery(C, z.object({ Date: z.iso.date() }));
  const CompanyId = C.get("Auth").CompanyId;
  const Start = sql`(${Day}::date)::timestamp AT TIME ZONE 'Africa/Cairo'`;
  const End = sql`(${Day}::date + 1)::timestamp AT TIME ZONE 'Africa/Cairo'`;
  const Rows = await Db.execute<{ ShiftId: number | null; UserId: number | null; CashIn: string; CashOut: string }>(sql`
    WITH Inflow AS (
      SELECT "ShiftId", sum("Amount") AS "In" FROM "Payments"
      WHERE "CompanyId" = ${CompanyId} AND "Method" = 'Cash' AND "Status" = 'Completed' AND "CreatedAt" >= ${Start} AND "CreatedAt" < ${End}
      GROUP BY "ShiftId"
    ),
    Outflow AS (
      SELECT co."ShiftId", sum(co."Amount") AS "Out" FROM "CashOuts" co JOIN "Shifts" s ON s."Id" = co."ShiftId"
      WHERE s."CompanyId" = ${CompanyId} AND co."CreatedAt" >= ${Start} AND co."CreatedAt" < ${End}
      GROUP BY co."ShiftId"
    ),
    Keys AS (SELECT "ShiftId" FROM Inflow UNION SELECT "ShiftId" FROM Outflow)
    SELECT k."ShiftId", s."UserId", coalesce(i."In", 0)::numeric(12,2)::text AS "CashIn", coalesce(o."Out", 0)::numeric(12,2)::text AS "CashOut"
    FROM Keys k
    LEFT JOIN Inflow i ON i."ShiftId" IS NOT DISTINCT FROM k."ShiftId"
    LEFT JOIN Outflow o ON o."ShiftId" IS NOT DISTINCT FROM k."ShiftId"
    LEFT JOIN "Shifts" s ON s."Id" = k."ShiftId"
    ORDER BY k."ShiftId" NULLS FIRST
  `);
  const Unassigned = Rows.rows.find((R) => R.ShiftId === null);
  const Shifts = Rows.rows.filter((R) => R.ShiftId !== null);
  const Total = Rows.rows.reduce((S, R) => S + ToPiasters(R.CashIn) - ToPiasters(R.CashOut), 0);
  return Ok(C, { Date: Day, Unassigned: Unassigned?.CashIn ?? "0.00", Shifts, Total: FromPiasters(Total) });
});
