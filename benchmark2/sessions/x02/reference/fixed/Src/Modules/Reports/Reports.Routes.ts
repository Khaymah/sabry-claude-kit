import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { RequireAuth, type AppEnv } from "../../Middleware/Auth";
import { Ok } from "../../Lib/Response";
import { Db } from "../../Database/Db";

export const ReportsRoutes = new Hono<AppEnv>();
ReportsRoutes.use("*", RequireAuth);

ReportsRoutes.get("/SalesBySalesperson", async (C) => {
  const CompanyId = C.get("Auth").CompanyId;
  const Result = (await Db.execute(sql`
    SELECT U."Id" AS "UserId", U."Name",
      count(Q."Id")::int AS "QuotesCount",
      count(O."Id") FILTER (WHERE O."Status" <> 'Cancelled')::int AS "OrdersCount",
      COALESCE(sum(O."Total") FILTER (WHERE O."Status" <> 'Cancelled'), 0)::numeric(14,2)::text AS "SalesTotal"
    FROM "Quotes" Q
    JOIN "Users" U ON U."Id" = Q."SalespersonId"
    LEFT JOIN "Orders" O ON O."Id" = Q."OrderId" AND O."CompanyId" = Q."CompanyId"
    WHERE Q."CompanyId" = ${CompanyId}
    GROUP BY U."Id", U."Name"
    ORDER BY COALESCE(sum(O."Total") FILTER (WHERE O."Status" <> 'Cancelled'), 0) DESC, U."Id"`)) as unknown as { rows: unknown[] };
  return Ok(C, { Items: Result.rows });
});
