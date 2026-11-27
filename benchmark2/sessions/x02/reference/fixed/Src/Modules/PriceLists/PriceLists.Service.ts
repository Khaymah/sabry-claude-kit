import { and, eq, inArray, sql } from "drizzle-orm";
import { Db, type Transaction } from "../../Database/Db";
import { Customers, PriceListItems, PriceLists, Products } from "../../Database/Schema";
import { AppError } from "../../Lib/Response";

type Executor = Transaction | typeof Db;
type PriceListInput = { CustomerId: number; ValidFrom: string; ValidTo?: string | null; Items: { ProductId: number; Price: string }[] };

export async function RequireCustomer(Ex: Executor, CompanyId: number, CustomerId: number) {
  const [Customer] = await Ex.select({ Id: Customers.Id, GroupId: Customers.GroupId })
    .from(Customers)
    .where(and(eq(Customers.Id, CustomerId), eq(Customers.CompanyId, CompanyId)));
  if (!Customer) throw new AppError(404, "NOT_FOUND", "Customer not found");
  return Customer;
}

export async function CreatePriceList(CompanyId: number, Input: PriceListInput) {
  return Db.transaction(async (Tx) => {
    await RequireCustomer(Tx, CompanyId, Input.CustomerId);
    const Ids = Input.Items.map((I) => I.ProductId);
    const Found = await Tx.select({ Id: Products.Id })
      .from(Products)
      .where(and(eq(Products.CompanyId, CompanyId), inArray(Products.Id, Ids)));
    if (Found.length !== Ids.length) throw new AppError(404, "NOT_FOUND", "Product not found");
    const [List] = await Tx.insert(PriceLists)
      .values({ CompanyId, CustomerId: Input.CustomerId, ValidFrom: Input.ValidFrom, ValidTo: Input.ValidTo ?? null })
      .returning();
    const Items = await Tx.insert(PriceListItems)
      .values(Input.Items.map((I) => ({ PriceListId: List.Id, ProductId: I.ProductId, Price: I.Price })))
      .returning({ ProductId: PriceListItems.ProductId, Price: PriceListItems.Price });
    return { ...List, Items };
  });
}

export async function PricesOn(Ex: Executor, CompanyId: number, CustomerId: number, Day: string, ProductIds?: number[]) {
  const Only = ProductIds ? sql`AND P."Id" IN (${sql.join(ProductIds.map((I) => sql`${I}`), sql`, `)})` : sql``;
  const Result = (await Ex.execute(sql`
    SELECT P."Id" AS "ProductId", COALESCE((
      SELECT I."Price" FROM "PriceListItems" I JOIN "PriceLists" L ON L."Id" = I."PriceListId"
      WHERE I."ProductId" = P."Id" AND L."CustomerId" = ${CustomerId} AND L."CompanyId" = ${CompanyId}
        AND L."ValidFrom" <= ${Day}::date AND (L."ValidTo" IS NULL OR L."ValidTo" >= ${Day}::date)
      ORDER BY L."Id" DESC LIMIT 1
    ), P."Price")::text AS "Price"
    FROM "Products" P
    WHERE P."CompanyId" = ${CompanyId} AND P."IsActive" ${Only}
    ORDER BY P."Id"`)) as unknown as { rows: { ProductId: number; Price: string }[] };
  return Result.rows;
}

export async function CustomerPrices(CompanyId: number, CustomerId: number, Day: string) {
  await RequireCustomer(Db, CompanyId, CustomerId);
  return { Date: Day, Items: await PricesOn(Db, CompanyId, CustomerId, Day) };
}
