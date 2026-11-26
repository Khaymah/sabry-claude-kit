import { and, eq, gte, lt, ne, sql } from "drizzle-orm";
import { Db } from "../../Database/Db";
import { Orders } from "../../Database/Schema";
import { FromPiasters, ToPiasters } from "../../Lib/Money";

export async function MonthlySales(CompanyId: number, Month: string) {
  const [Year, M] = Month.split("-").map(Number);
  const DaysInMonth = new Date(Date.UTC(Year, M, 0)).getUTCDate();
  const Days = [];
  let OrdersCount = 0;
  let Revenue = 0;
  for (let Day = 1; Day <= DaysInMonth; Day++) {
    const From = new Date(Date.UTC(Year, M - 1, Day));
    const To = new Date(Date.UTC(Year, M - 1, Day + 1));
    const [Row] = await Db.select({
      Count: sql<number>`count(*) FILTER (WHERE ${Orders.Status} <> 'Cancelled')::int`,
      Revenue: sql<string>`coalesce(sum(${Orders.Total}) FILTER (WHERE ${Orders.Status} = 'Paid'), 0)::text`,
    })
      .from(Orders)
      .where(and(eq(Orders.CompanyId, CompanyId), gte(Orders.CreatedAt, From), lt(Orders.CreatedAt, To)));
    OrdersCount += Row.Count;
    Revenue += ToPiasters(Number(Row.Revenue).toFixed(2));
    Days.push({ Date: From.toISOString().slice(0, 10), OrdersCount: Row.Count, Revenue: Number(Row.Revenue).toFixed(2) });
  }
  return { Month, OrdersCount, Revenue: FromPiasters(Revenue), Days };
}
