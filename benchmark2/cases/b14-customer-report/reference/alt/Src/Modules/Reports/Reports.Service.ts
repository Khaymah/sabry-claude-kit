import { count, eq, inArray, sql } from "drizzle-orm";
import { Db } from "../../Database/Db";
import { Customers } from "../../Database/Schema";

export async function CustomerReport(CompanyId: number, Page: number, PageSize: number) {
  const Ranked = await Db.execute<{ CustomerId: number; OrdersCount: number; TotalSpent: string; LastOrderAt: string | null }>(sql`
    SELECT c."Id" AS "CustomerId",
           count(o."Id") FILTER (WHERE o."Status" <> 'Cancelled')::int AS "OrdersCount",
           coalesce(sum(o."Total") FILTER (WHERE o."Status" = 'Paid'), 0)::numeric(12,2) AS "Spent",
           coalesce(sum(o."Total") FILTER (WHERE o."Status" = 'Paid'), 0)::numeric(12,2)::text AS "TotalSpent",
           max(o."CreatedAt") FILTER (WHERE o."Status" <> 'Cancelled') AS "LastOrderAt"
    FROM "Customers" c LEFT JOIN "Orders" o ON o."CustomerId" = c."Id" AND o."CompanyId" = c."CompanyId"
    WHERE c."CompanyId" = ${CompanyId}
    GROUP BY c."Id"
    ORDER BY "Spent" DESC, c."Id" ASC
    LIMIT ${PageSize} OFFSET ${(Page - 1) * PageSize}
  `);
  const Ids = Ranked.rows.map((R) => R.CustomerId);
  const Names = Ids.length ? await Db.select({ Id: Customers.Id, Name: Customers.Name }).from(Customers).where(inArray(Customers.Id, Ids)) : [];
  const NameOf = new Map(Names.map((N) => [N.Id, N.Name]));
  const [{ Total }] = await Db.select({ Total: count() }).from(Customers).where(eq(Customers.CompanyId, CompanyId));
  const Items = Ranked.rows.map((R) => ({
    CustomerId: R.CustomerId,
    Name: NameOf.get(R.CustomerId)!,
    OrdersCount: Number(R.OrdersCount),
    TotalSpent: R.TotalSpent,
    LastOrderAt: R.LastOrderAt ? new Date(R.LastOrderAt).toISOString() : null,
  }));
  return { Items, Page, PageSize, Total };
}
