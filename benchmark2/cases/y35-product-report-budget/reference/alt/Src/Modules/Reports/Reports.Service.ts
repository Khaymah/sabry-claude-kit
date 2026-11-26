import { sql } from "drizzle-orm";
import { Db } from "../../Database/Db";
import { Now } from "../../Lib/Clock";

const MaxAgeMs = 10 * 60_000;

async function Refresh(CompanyId: number, At: Date) {
  await Db.execute(sql`DELETE FROM "ProductReportRows" WHERE "CompanyId" = ${CompanyId}`);
  await Db.execute(sql`
    INSERT INTO "ProductReportRows" ("CompanyId","ProductId","Name","Stock","SoldQuantity","Revenue","LastSoldAt","GeneratedAt")
    SELECT p."CompanyId", p."Id", p."Name", p."Stock",
           coalesce(sum(i."Quantity") FILTER (WHERE o."Status" <> 'Cancelled'), 0),
           coalesce(sum(i."LineTotal") FILTER (WHERE o."Status" = 'Paid'), 0),
           max(o."CreatedAt") FILTER (WHERE o."Status" <> 'Cancelled'),
           ${At.toISOString()}::timestamptz
    FROM "Products" p
    LEFT JOIN "OrderItems" i ON i."ProductId" = p."Id"
    LEFT JOIN "Orders" o ON o."Id" = i."OrderId"
    WHERE p."CompanyId" = ${CompanyId}
    GROUP BY p."Id"
  `);
}

export async function ProductReport(CompanyId: number, Page: number, PageSize: number) {
  const At = Now();
  const Fresh = await Db.execute<{ G: string | null }>(sql`SELECT max("GeneratedAt")::text AS "G" FROM "ProductReportRows" WHERE "CompanyId" = ${CompanyId}`);
  const Generated = Fresh.rows[0]?.G ? new Date(Fresh.rows[0].G) : null;
  if (!Generated || At.getTime() - Generated.getTime() > MaxAgeMs) await Refresh(CompanyId, At);
  const Rows = await Db.execute<{ ProductId: number; Name: string; Stock: number; SoldQuantity: number; Revenue: string; LastSoldAt: string | null; Total: number }>(sql`
    SELECT "ProductId", "Name", "Stock", "SoldQuantity", "Revenue"::text AS "Revenue",
           to_char("LastSoldAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "LastSoldAt",
           count(*) OVER ()::int AS "Total"
    FROM "ProductReportRows" WHERE "CompanyId" = ${CompanyId}
    ORDER BY "ProductReportRows"."Revenue" DESC, "ProductReportRows"."ProductId" ASC
    LIMIT ${PageSize} OFFSET ${(Page - 1) * PageSize}
  `);
  const Total = Rows.rows[0]?.Total ?? 0;
  return { Items: Rows.rows.map(({ Total: _, ...R }) => R), Page, PageSize, Total };
}
