import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { RequireAuth, type AppEnv } from "../../Middleware/Auth";
import { Db } from "../../Database/Db";
import { Ok } from "../../Lib/Response";
import { ParseQuery } from "../../Lib/Validate";
import { PageMeta, PageQuery } from "../../Lib/Pagination";
import { Rows } from "../Stores/Stores.Service";

type Line = { ProductId: number; Sku: string; Name: string; Warehouses: { WarehouseId: number; Name: string; Quantity: number; Incoming: number }[]; Total: number };

export const ReportsRoutes = new Hono<AppEnv>();
ReportsRoutes.use("*", RequireAuth);

ReportsRoutes.get("/StockByWarehouse", async (C) => {
  const { Page, PageSize } = ParseQuery(C, PageQuery);
  const CompanyId = C.get("Auth").CompanyId;
  const Lines = await Rows<Line>(
    Db,
    sql`WITH Pg AS (
          SELECT "Id", "Sku", "Name", count(*) OVER ()::int AS "Total" FROM "Products" WHERE "CompanyId" = ${CompanyId}
          ORDER BY "Sku", "Id" LIMIT ${PageSize} OFFSET ${(Page - 1) * PageSize}
        ),
        Shelf AS (
          SELECT L."ProductId", L."StoreId", sum(L."Delta")::int AS "Qty" FROM "StockLedger" L JOIN Pg ON Pg."Id" = L."ProductId"
          WHERE L."CompanyId" = ${CompanyId} GROUP BY L."ProductId", L."StoreId"
        ),
        Road AS (
          SELECT (E->>'ProductId')::int AS "ProductId", T."ToStoreId" AS "StoreId", sum((E->>'Quantity')::int)::int AS "Qty"
          FROM "StockTransfers" T CROSS JOIN LATERAL jsonb_array_elements(T."Lines") E
          WHERE T."CompanyId" = ${CompanyId} AND T."State" = 'InTransit' GROUP BY 1, 2
        )
        SELECT Pg."Id" AS "ProductId", Pg."Sku", Pg."Name", Pg."Total",
          coalesce((SELECT json_agg(json_build_object('WarehouseId', S."Id", 'Name', S."Name", 'Quantity', coalesce(Sh."Qty", 0), 'Incoming', coalesce(R."Qty", 0)) ORDER BY S."Id")
            FROM "Stores" S
            LEFT JOIN Shelf Sh ON Sh."StoreId" = S."Id" AND Sh."ProductId" = Pg."Id"
            LEFT JOIN Road R ON R."StoreId" = S."Id" AND R."ProductId" = Pg."Id"
            WHERE S."CompanyId" = ${CompanyId} AND (Sh."Qty" IS NOT NULL OR R."Qty" IS NOT NULL)), '[]'::json) AS "Warehouses"
        FROM Pg ORDER BY Pg."Sku", Pg."Id"`,
  );
  let Total = Lines[0]?.Total;
  if (Total === undefined) {
    const [Count] = await Rows<{ N: number }>(Db, sql`SELECT count(*)::int AS "N" FROM "Products" WHERE "CompanyId" = ${CompanyId}`);
    Total = Count.N;
  }
  const Items = Lines.map(({ Total: _, ...L }) => {
    const InTransit = L.Warehouses.reduce((S, W) => S + W.Incoming, 0);
    const OnShelves = L.Warehouses.reduce((S, W) => S + W.Quantity, 0);
    return { ...L, InTransit, TotalQuantity: OnShelves + InTransit };
  });
  return Ok(C, { Items, ...PageMeta(Page, PageSize, Total) });
});
