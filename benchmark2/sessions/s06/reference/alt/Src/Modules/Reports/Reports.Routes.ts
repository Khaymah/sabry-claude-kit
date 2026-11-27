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
  const Rows = await Db.execute<{ ShiftId: number | null; UserId: number | null; CashIn: string; CashOut: string }>(sql`
    WITH Bounds AS (SELECT (${Day}::date)::timestamp AT TIME ZONE 'Africa/Cairo' AS "S", (${Day}::date + 1)::timestamp AT TIME ZONE 'Africa/Cairo' AS "E"),
    Cash AS (
      SELECT p."Amount", (SELECT s."Id" FROM "Shifts" s WHERE s."UserId" = p."TakenBy" AND p."CreatedAt" >= s."OpenedAt" AND (s."ClosedAt" IS NULL OR p."CreatedAt" < s."ClosedAt") LIMIT 1) AS "ShiftId"
      FROM "Payments" p, Bounds b
      WHERE p."CompanyId" = ${CompanyId} AND p."Method" = 'Cash' AND p."Status" = 'Completed' AND p."CreatedAt" >= b."S" AND p."CreatedAt" < b."E"
    ),
    Moves AS (
      SELECT m."ShiftId", -sum(m."Change") AS "Out" FROM "DrawerMoves" m JOIN "Shifts" s ON s."Id" = m."ShiftId", Bounds b
      WHERE s."CompanyId" = ${CompanyId} AND m."At" >= b."S" AND m."At" < b."E" GROUP BY m."ShiftId"
    ),
    Ins AS (SELECT "ShiftId", sum("Amount") AS "In" FROM Cash GROUP BY "ShiftId"),
    Keys AS (SELECT "ShiftId" FROM Ins UNION SELECT "ShiftId" FROM Moves)
    SELECT k."ShiftId", s."UserId", coalesce(i."In", 0)::numeric(12,2)::text AS "CashIn", coalesce(m."Out", 0)::numeric(12,2)::text AS "CashOut"
    FROM Keys k LEFT JOIN Ins i ON i."ShiftId" IS NOT DISTINCT FROM k."ShiftId" LEFT JOIN Moves m ON m."ShiftId" IS NOT DISTINCT FROM k."ShiftId"
    LEFT JOIN "Shifts" s ON s."Id" = k."ShiftId"
  `);
  const Net = Rows.rows.reduce((S, R) => S + ToPiasters(R.CashIn) - ToPiasters(R.CashOut), 0);
  return Ok(C, {
    Date: Day,
    Unassigned: Rows.rows.find((R) => R.ShiftId === null)?.CashIn ?? "0.00",
    Shifts: Rows.rows.filter((R) => R.ShiftId !== null),
    Total: FromPiasters(Net),
  });
});
