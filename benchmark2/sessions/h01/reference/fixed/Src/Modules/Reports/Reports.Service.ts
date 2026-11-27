import { and, asc, count, eq, inArray } from "drizzle-orm";
import { Db } from "../../Database/Db";
import { Products, WarehouseStock, Warehouses } from "../../Database/Schema";
import { PageMeta } from "../../Lib/Pagination";
import { InTransitByProduct } from "../Transfers/Transfers.Service";

export async function StockByWarehouse(CompanyId: number, Page: number, PageSize: number) {
  const Where = eq(Products.CompanyId, CompanyId);
  const Rows = await Db.select({ ProductId: Products.Id, Sku: Products.Sku, Name: Products.Name })
    .from(Products)
    .where(Where)
    .orderBy(asc(Products.Sku), asc(Products.Id))
    .limit(PageSize)
    .offset((Page - 1) * PageSize);
  const [{ Total }] = await Db.select({ Total: count() }).from(Products).where(Where);
  const Ids = Rows.map((R) => R.ProductId);
  const Branches = await Db.select({ Id: Warehouses.Id, Name: Warehouses.Name }).from(Warehouses).where(eq(Warehouses.CompanyId, CompanyId)).orderBy(asc(Warehouses.Id));
  const Stock = Ids.length
    ? await Db.select().from(WarehouseStock).where(and(eq(WarehouseStock.CompanyId, CompanyId), inArray(WarehouseStock.ProductId, Ids)))
    : [];
  const Moving = await InTransitByProduct(CompanyId, Ids);
  const Key = (ProductId: number, WarehouseId: number) => `${ProductId}:${WarehouseId}`;
  const OnShelf = new Map(Stock.map((S) => [Key(S.ProductId, S.WarehouseId), S.Quantity]));
  const Incoming = new Map<string, number>();
  for (const M of Moving) Incoming.set(Key(M.ProductId, M.WarehouseId), (Incoming.get(Key(M.ProductId, M.WarehouseId)) ?? 0) + M.Quantity);
  const Items = Rows.map((R) => {
    const PerBranch = Branches.map((B) => ({
      WarehouseId: B.Id,
      Name: B.Name,
      Quantity: OnShelf.get(Key(R.ProductId, B.Id)) ?? 0,
      Incoming: Incoming.get(Key(R.ProductId, B.Id)) ?? 0,
    }));
    const InTransit = PerBranch.reduce((S, B) => S + B.Incoming, 0);
    const Shelves = PerBranch.reduce((S, B) => S + B.Quantity, 0);
    return { ...R, TotalQuantity: Shelves + InTransit, InTransit, Warehouses: PerBranch };
  });
  return { Items, ...PageMeta(Page, PageSize, Total) };
}
