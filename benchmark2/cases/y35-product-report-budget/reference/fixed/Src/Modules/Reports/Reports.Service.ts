import { asc, count, desc, eq, sql } from "drizzle-orm";
import { Db } from "../../Database/Db";
import { OrderItems, Orders, Products } from "../../Database/Schema";

export async function ProductReport(CompanyId: number, Page: number, PageSize: number) {
  const Stats = Db.select({
    ProductId: OrderItems.ProductId,
    SoldQuantity: sql<number>`sum(${OrderItems.Quantity}) FILTER (WHERE ${Orders.Status} <> 'Cancelled')`.as("SoldQuantity"),
    Revenue: sql<string>`sum(${OrderItems.LineTotal}) FILTER (WHERE ${Orders.Status} = 'Paid')`.as("Revenue"),
    LastSoldAt: sql<Date | null>`max(${Orders.CreatedAt}) FILTER (WHERE ${Orders.Status} <> 'Cancelled')`.as("LastSoldAt"),
  })
    .from(OrderItems)
    .innerJoin(Orders, eq(Orders.Id, OrderItems.OrderId))
    .where(eq(Orders.CompanyId, CompanyId))
    .groupBy(OrderItems.ProductId)
    .as("Stats");
  const Revenue = sql`coalesce(${Stats.Revenue}, 0)`;
  const Items = await Db.select({
    ProductId: Products.Id,
    Name: Products.Name,
    Stock: Products.Stock,
    SoldQuantity: sql<number>`coalesce(${Stats.SoldQuantity}, 0)::int`,
    Revenue: sql<string>`(${Revenue})::numeric(12,2)::text`,
    LastSoldAt: sql<string | null>`to_char(${Stats.LastSoldAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
  })
    .from(Products)
    .leftJoin(Stats, eq(Stats.ProductId, Products.Id))
    .where(eq(Products.CompanyId, CompanyId))
    .orderBy(desc(Revenue), asc(Products.Id))
    .limit(PageSize)
    .offset((Page - 1) * PageSize);
  const [{ Total }] = await Db.select({ Total: count() }).from(Products).where(eq(Products.CompanyId, CompanyId));
  return { Items, Page, PageSize, Total };
}
