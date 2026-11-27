import { asc, count, desc, eq, sql } from "drizzle-orm";
import { Db } from "../../Database/Db";
import { Customers, Orders } from "../../Database/Schema";

export async function CustomerReport(CompanyId: number, Page: number, PageSize: number) {
  const Stats = Db.select({
    CustomerId: Orders.CustomerId,
    OrdersCount: sql<number>`count(*) FILTER (WHERE ${Orders.Status} <> 'Cancelled')::int`.as("OrdersCount"),
    TotalSpent: sql<string>`coalesce(sum(${Orders.Total}) FILTER (WHERE ${Orders.Status} = 'Paid'), 0)`.as("TotalSpent"),
    LastOrderAt: sql<Date | null>`max(${Orders.CreatedAt}) FILTER (WHERE ${Orders.Status} <> 'Cancelled')`.as("LastOrderAt"),
  })
    .from(Orders)
    .where(eq(Orders.CompanyId, CompanyId))
    .groupBy(Orders.CustomerId)
    .as("Stats");
  const Spent = sql`coalesce(${Stats.TotalSpent}, 0)`;
  const Rows = await Db.select({
    CustomerId: Customers.Id,
    Name: Customers.Name,
    OrdersCount: sql<number>`coalesce(${Stats.OrdersCount}, 0)::int`,
    TotalSpent: sql<string>`(${Spent})::numeric(12,2)::text`,
    LastOrderAt: sql<string | null>`to_char(${Stats.LastOrderAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
  })
    .from(Customers)
    .leftJoin(Stats, eq(Stats.CustomerId, Customers.Id))
    .where(eq(Customers.CompanyId, CompanyId))
    .orderBy(desc(Spent), asc(Customers.Id))
    .limit(PageSize)
    .offset((Page - 1) * PageSize);
  const [{ Total }] = await Db.select({ Total: count() }).from(Customers).where(eq(Customers.CompanyId, CompanyId));
  return { Items: Rows, Page, PageSize, Total };
}
