import { and, count, desc, eq } from "drizzle-orm";
import { Db } from "../../Database/Db";
import { Products } from "../../Database/Schema";
import { AppError } from "../../Lib/Response";
import { PageMeta } from "../../Lib/Pagination";
import { RecordPriceChange } from "./Products.Pricing";

export async function ListProducts(CompanyId: number, Page: number, PageSize: number) {
  const Where = eq(Products.CompanyId, CompanyId);
  const Items = await Db.select()
    .from(Products)
    .where(Where)
    .orderBy(desc(Products.CreatedAt), desc(Products.Id))
    .limit(PageSize)
    .offset((Page - 1) * PageSize);
  const [{ Total }] = await Db.select({ Total: count() }).from(Products).where(Where);
  return { Items, ...PageMeta(Page, PageSize, Total) };
}

export async function GetProduct(CompanyId: number, Id: number) {
  const [Product] = await Db.select()
    .from(Products)
    .where(and(eq(Products.Id, Id), eq(Products.CompanyId, CompanyId)));
  if (!Product) throw new AppError(404, "NOT_FOUND", "Product not found");
  return Product;
}

export async function CreateProduct(CompanyId: number, Input: { Name: string; Sku: string; Price: string; Stock: number }) {
  const [Existing] = await Db.select({ Id: Products.Id })
    .from(Products)
    .where(and(eq(Products.CompanyId, CompanyId), eq(Products.Sku, Input.Sku)));
  if (Existing) throw new AppError(409, "SKU_TAKEN", "SKU already exists");
  const [Product] = await Db.insert(Products).values({ CompanyId, ...Input }).returning();
  return Product;
}

export async function UpdateProduct(
  CompanyId: number,
  Id: number,
  Input: { Name?: string; Price?: string; Stock?: number; IsActive?: boolean },
) {
  return Db.transaction(async (Tx) => {
    const [Before] = await Tx.select().from(Products).where(and(eq(Products.Id, Id), eq(Products.CompanyId, CompanyId))).for("update");
    if (!Before) throw new AppError(404, "NOT_FOUND", "Product not found");
    const [Product] = await Tx.update(Products).set(Input).where(eq(Products.Id, Id)).returning();
    await RecordPriceChange(Tx, CompanyId, Id, Before.Price, Product.Price);
    return Product;
  });
}
