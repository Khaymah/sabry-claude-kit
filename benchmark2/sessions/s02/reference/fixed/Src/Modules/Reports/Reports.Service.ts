import { sql } from "drizzle-orm";
import { Db } from "../../Database/Db";

export async function SupplierReport(CompanyId: number, Page: number, PageSize: number) {
  const Rows = await Db.execute<{ SupplierId: number; Name: string; OrdersCount: number; ReceivedValue: string; OpenValue: string; Total: number }>(sql`
    WITH Lines AS (
      SELECT po."SupplierId", po."Id" AS "PoId", i."ReceivedQuantity" * i."UnitCost" AS "Received", (i."Quantity" - i."ReceivedQuantity") * i."UnitCost" AS "Open"
      FROM "PurchaseOrders" po JOIN "PurchaseOrderItems" i ON i."PurchaseOrderId" = po."Id"
      WHERE po."CompanyId" = ${CompanyId}
    ),
    Stats AS (
      SELECT "SupplierId", count(DISTINCT "PoId")::int AS "OrdersCount", sum("Received") AS "Received", sum("Open") AS "Open" FROM Lines GROUP BY "SupplierId"
    )
    SELECT s."Id" AS "SupplierId", s."Name", coalesce(st."OrdersCount", 0)::int AS "OrdersCount",
           coalesce(st."Received", 0)::numeric(12,2)::text AS "ReceivedValue", coalesce(st."Open", 0)::numeric(12,2)::text AS "OpenValue",
           count(*) OVER ()::int AS "Total"
    FROM "Suppliers" s LEFT JOIN Stats st ON st."SupplierId" = s."Id"
    WHERE s."CompanyId" = ${CompanyId}
    ORDER BY coalesce(st."Received", 0) DESC, s."Id" ASC
    LIMIT ${PageSize} OFFSET ${(Page - 1) * PageSize}
  `);
  return { Items: Rows.rows.map(({ Total: _, ...R }) => R), Page, PageSize, Total: Rows.rows[0]?.Total ?? 0 };
}
