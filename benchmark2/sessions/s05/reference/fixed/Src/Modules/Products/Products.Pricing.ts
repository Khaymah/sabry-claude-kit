import { and, asc, count, desc, eq, inArray, lte } from "drizzle-orm";
import { Db, type Transaction } from "../../Database/Db";
import { PriceChanges, Products } from "../../Database/Schema";
import { AppError } from "../../Lib/Response";
import { Now } from "../../Lib/Clock";
import { FromPiasters, ToPiasters } from "../../Lib/Money";
import { PageMeta } from "../../Lib/Pagination";

export async function RecordPriceChange(Tx: Transaction, CompanyId: number, ProductId: number, OldPrice: string, NewPrice: string) {
  if (ToPiasters(OldPrice) === ToPiasters(NewPrice)) return;
  await Tx.insert(PriceChanges).values({ CompanyId, ProductId, OldPrice, NewPrice, ChangedAt: Now() });
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
  return Db.select({ OldPrice: PriceChanges.OldPrice, NewPrice: PriceChanges.NewPrice, ChangedAt: PriceChanges.ChangedAt })
    .from(PriceChanges)
    .where(eq(PriceChanges.ProductId, ProductId))
    .orderBy(desc(PriceChanges.ChangedAt), desc(PriceChanges.Id));
}

export async function LowStock(CompanyId: number, Threshold: number, Page: number, PageSize: number) {
  const Where = and(eq(Products.CompanyId, CompanyId), eq(Products.IsActive, true), lte(Products.Stock, Threshold));
  const Items = await Db.select().from(Products).where(Where).orderBy(asc(Products.Stock), asc(Products.Id)).limit(PageSize).offset((Page - 1) * PageSize);
  const [{ Total }] = await Db.select({ Total: count() }).from(Products).where(Where);
  return { Items, ...PageMeta(Page, PageSize, Total) };
}
