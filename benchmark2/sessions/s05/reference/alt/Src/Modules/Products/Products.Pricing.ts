import { and, asc, count, desc, eq, inArray, lte } from "drizzle-orm";
import { Db, type Transaction } from "../../Database/Db";
import { PriceVersions, Products } from "../../Database/Schema";
import { sql } from "drizzle-orm";
import { AppError } from "../../Lib/Response";
import { Now } from "../../Lib/Clock";
import { FromPiasters, ToPiasters } from "../../Lib/Money";
import { PageMeta } from "../../Lib/Pagination";

export async function RecordPriceChange(Tx: Transaction, CompanyId: number, ProductId: number, OldPrice: string, NewPrice: string) {
  if (ToPiasters(OldPrice) === ToPiasters(NewPrice)) return;
  const [Any] = await Tx.select({ Id: PriceVersions.Id }).from(PriceVersions).where(eq(PriceVersions.ProductId, ProductId)).limit(1);
  const At = Now();
  if (!Any) await Tx.insert(PriceVersions).values({ CompanyId, ProductId, Price: OldPrice, ValidFrom: new Date(0) });
  await Tx.insert(PriceVersions).values({ CompanyId, ProductId, Price: NewPrice, ValidFrom: At });
}

async function Apply(CompanyId: number, Changes: Map<number, (Old: number) => number>) {
  return Db.transaction(async (Tx) => {
    const Ids = [...Changes.keys()];
    const Found = Ids.length ? await Tx.select().from(Products).where(and(eq(Products.CompanyId, CompanyId), inArray(Products.Id, Ids))).for("update") : [];
    if (Found.length !== Ids.length) throw new AppError(404, "NOT_FOUND", "Some products were not found");
    for (const Product of Found) {
      const Next = Changes.get(Product.Id)!(ToPiasters(Product.Price));
      if (Next < 0) throw new AppError(400, "VALIDATION_ERROR", "Price would become negative");
      const NewPrice = FromPiasters(Next);
      await Tx.update(Products).set({ Price: NewPrice }).where(eq(Products.Id, Product.Id));
      await RecordPriceChange(Tx, CompanyId, Product.Id, Product.Price, NewPrice);
    }
    return { Updated: Found.length };
  });
}

export async function BulkSetPrices(CompanyId: number, Items: { ProductId: number; Price: string }[]) {
  const Changes = new Map<number, (Old: number) => number>();
  for (const Item of Items) Changes.set(Item.ProductId, () => ToPiasters(Item.Price));
  return Apply(CompanyId, Changes);
}

export async function IncreasePrices(CompanyId: number, Percent: number, ProductIds?: number[]) {
  const Ids = ProductIds ?? (await Db.select({ Id: Products.Id }).from(Products).where(and(eq(Products.CompanyId, CompanyId), eq(Products.IsActive, true)))).map((P) => P.Id);
  const Basis = 10000 + Math.round(Percent * 100);
  const Changes = new Map<number, (Old: number) => number>();
  for (const Id of Ids) Changes.set(Id, (Old) => Math.floor((Old * Basis * 2 + 10000) / 20000));
  return Apply(CompanyId, Changes);
}

export async function PriceHistory(CompanyId: number, ProductId: number) {
  const [Product] = await Db.select({ Id: Products.Id }).from(Products).where(and(eq(Products.Id, ProductId), eq(Products.CompanyId, CompanyId)));
  if (!Product) throw new AppError(404, "NOT_FOUND", "Product not found");
  const Rows = await Db.execute<{ OldPrice: string; NewPrice: string; ChangedAt: string }>(sql`
    SELECT * FROM (
      SELECT lag("Price") OVER (ORDER BY "Id")::text AS "OldPrice", "Price"::text AS "NewPrice", "ValidFrom" AS "ChangedAt", "Id"
      FROM "PriceVersions" WHERE "ProductId" = ${ProductId}
    ) v WHERE "OldPrice" IS NOT NULL ORDER BY "Id" DESC
  `);
  return Rows.rows.map((R) => ({ OldPrice: R.OldPrice, NewPrice: R.NewPrice, ChangedAt: new Date(R.ChangedAt).toISOString() }));
}

export async function LowStock(CompanyId: number, Threshold: number, Page: number, PageSize: number) {
  const Where = and(eq(Products.CompanyId, CompanyId), eq(Products.IsActive, true), lte(Products.Stock, Threshold));
  const Items = await Db.select().from(Products).where(Where).orderBy(asc(Products.Stock), asc(Products.Id)).limit(PageSize).offset((Page - 1) * PageSize);
  const [{ Total }] = await Db.select({ Total: count() }).from(Products).where(Where);
  return { Items, ...PageMeta(Page, PageSize, Total) };
}
