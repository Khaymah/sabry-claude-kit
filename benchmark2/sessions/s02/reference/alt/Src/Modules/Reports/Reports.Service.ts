import { sql } from "drizzle-orm";
import { Db } from "../../Database/Db";

export async function SupplierReport(CompanyId: number, Page: number, PageSize: number) {
  const Ranked = await Db.execute<{ SupplierId: number; OrdersCount: number; ReceivedValue: string; OpenValue: string }>(sql`
    WITH Got AS (
      SELECT "PurchaseOrderId", "ProductId", sum("Quantity") AS "Q" FROM "PurchaseReceiptLines" GROUP BY 1, 2
    ),
    HasReceipts AS (SELECT DISTINCT "PurchaseOrderId" FROM "PurchaseReceiptLines"),
    Lines AS (
      SELECT po."SupplierId", po."Id" AS "PoId", i."UnitCost", i."Quantity",
             CASE WHEN po."Status" = 'Received' AND hr."PurchaseOrderId" IS NULL THEN i."Quantity" ELSE coalesce(g."Q", 0) END AS "Got"
      FROM "PurchaseOrders" po
      JOIN "PurchaseOrderItems" i ON i."PurchaseOrderId" = po."Id"
      LEFT JOIN Got g ON g."PurchaseOrderId" = po."Id" AND g."ProductId" = i."ProductId"
      LEFT JOIN HasReceipts hr ON hr."PurchaseOrderId" = po."Id"
      WHERE po."CompanyId" = ${CompanyId}
    )
    SELECT s."Id" AS "SupplierId",
           count(DISTINCT l."PoId")::int AS "OrdersCount",
           coalesce(sum(l."Got" * l."UnitCost"), 0)::numeric(12,2)::text AS "ReceivedValue",
           coalesce(sum((l."Quantity" - l."Got") * l."UnitCost"), 0)::numeric(12,2)::text AS "OpenValue"
    FROM "Suppliers" s LEFT JOIN Lines l ON l."SupplierId" = s."Id"
    WHERE s."CompanyId" = ${CompanyId}
    GROUP BY s."Id"
    ORDER BY coalesce(sum(l."Got" * l."UnitCost"), 0) DESC, s."Id"
    LIMIT ${PageSize} OFFSET ${(Page - 1) * PageSize}
  `);
  const Ids = Ranked.rows.map((R) => R.SupplierId);
  const Names = Ids.length ? await Db.execute<{ Id: number; Name: string }>(sql`SELECT "Id", "Name" FROM "Suppliers" WHERE "Id" = ANY(${`{${Ids.join(",")}}`}::int[])`) : { rows: [] };
  const NameOf = new Map(Names.rows.map((N) => [N.Id, N.Name]));
  const Count = await Db.execute<{ N: number }>(sql`SELECT count(*)::int AS "N" FROM "Suppliers" WHERE "CompanyId" = ${CompanyId}`);
  return { Items: Ranked.rows.map((R) => ({ ...R, Name: NameOf.get(R.SupplierId)! })), Page, PageSize, Total: Count.rows[0].N };
}
