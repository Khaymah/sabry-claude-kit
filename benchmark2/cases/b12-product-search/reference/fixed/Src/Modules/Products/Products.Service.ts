import { and, asc, count, desc, eq, gt, gte, lte, sql, type SQL } from "drizzle-orm";
import { Db } from "../../Database/Db";
import { Products } from "../../Database/Schema";
import { AppError } from "../../Lib/Response";
import { PageMeta } from "../../Lib/Pagination";
import type { SearchInput } from "./Products.Schema";

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
  const [Product] = await Db.update(Products)
    .set(Input)
    .where(and(eq(Products.Id, Id), eq(Products.CompanyId, CompanyId)))
    .returning();
  if (!Product) throw new AppError(404, "NOT_FOUND", "Product not found");
  return Product;
}

const Diacritics = /[\u064B-\u0652\u0640]/g;

export function NormalizeArabic(Text: string) {
  return Text.toLowerCase()
    .replace(Diacritics, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي");
}

function NormalizedColumn(Column: SQL | typeof Products.Name) {
  return sql`translate(regexp_replace(lower(${Column}), '[\u064B-\u0652\u0640]', '', 'g'), 'أإآةى', 'اااهي')`;
}

export async function SearchProducts(CompanyId: number, Input: SearchInput) {
  const Filters: SQL[] = [eq(Products.CompanyId, CompanyId), eq(Products.IsActive, true)];
  if (Input.Q) {
    const Pattern = `%${NormalizeArabic(Input.Q).replace(/[\\%_]/g, (Ch) => `\\${Ch}`)}%`;
    Filters.push(sql`(${NormalizedColumn(Products.Name)} LIKE ${Pattern} ESCAPE '\\' OR lower(${Products.Sku}) LIKE ${Pattern} ESCAPE '\\')`);
  }
  if (Input.MinPrice !== undefined) Filters.push(gte(Products.Price, Input.MinPrice));
  if (Input.MaxPrice !== undefined) Filters.push(lte(Products.Price, Input.MaxPrice));
  if (Input.InStock === "true") Filters.push(gt(Products.Stock, 0));
  if (Input.InStock === "false") Filters.push(eq(Products.Stock, 0));
  const Where = and(...Filters);
  const Order = {
    PriceAsc: [asc(Products.Price), asc(Products.Id)],
    PriceDesc: [desc(Products.Price), desc(Products.Id)],
    Newest: [desc(Products.CreatedAt), desc(Products.Id)],
    Name: [asc(Products.Name), asc(Products.Id)],
  }[Input.Sort];
  const Items = await Db.select()
    .from(Products)
    .where(Where)
    .orderBy(...Order)
    .limit(Input.PageSize)
    .offset((Input.Page - 1) * Input.PageSize);
  const [{ Total }] = await Db.select({ Total: count() }).from(Products).where(Where);
  return { Items, Page: Input.Page, PageSize: Input.PageSize, Total };
}
