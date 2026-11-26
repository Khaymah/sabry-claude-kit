import { Hono } from "hono";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { RequireAuth, type AppEnv } from "../../Middleware/Auth";
import { Db } from "../../Database/Db";
import { Ok } from "../../Lib/Response";
import { ParseQuery } from "../../Lib/Validate";
import { PageMeta, PageQuery } from "../../Lib/Pagination";

export const ReportsRoutes = new Hono<AppEnv>();
ReportsRoutes.use("*", RequireAuth);

ReportsRoutes.get("/PriceChanges", async (C) => {
  const Query = ParseQuery(C, PageQuery.extend({ From: z.iso.date(), To: z.iso.date() }));
  const CompanyId = C.get("Auth").CompanyId;
  const Rows = await Db.execute<{ ProductId: number; ProductName: string; OldPrice: string; NewPrice: string; ChangedAt: string; Total: number }>(sql`
    WITH Pairs AS (
      SELECT v."Id", v."ProductId", lag(v."Price") OVER (PARTITION BY v."ProductId" ORDER BY v."Id") AS "OldPrice", v."Price" AS "NewPrice", v."ValidFrom"
      FROM "PriceVersions" v WHERE v."CompanyId" = ${CompanyId}
    )
    SELECT p."ProductId", pr."Name" AS "ProductName", p."OldPrice"::text AS "OldPrice", p."NewPrice"::text AS "NewPrice", p."ValidFrom" AS "ChangedAt", count(*) OVER ()::int AS "Total"
    FROM Pairs p JOIN "Products" pr ON pr."Id" = p."ProductId"
    WHERE p."OldPrice" IS NOT NULL AND p."ValidFrom" >= ${Query.From}::date AND p."ValidFrom" < (${Query.To}::date + 1)
    ORDER BY p."ValidFrom" DESC, p."Id" DESC
    LIMIT ${Query.PageSize} OFFSET ${(Query.Page - 1) * Query.PageSize}
  `);
  const Total = Rows.rows[0]?.Total ?? 0;
  return Ok(C, { Items: Rows.rows.map(({ Total: _, ...R }) => R), ...PageMeta(Query.Page, Query.PageSize, Total) });
});
