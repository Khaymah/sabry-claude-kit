import { sql } from "drizzle-orm";
import { Db } from "../../Database/Db";
import { Orders } from "../../Database/Schema";

const BusinessTimeZone = "Africa/Cairo";

export async function MonthlySales(CompanyId: number, Month: string) {
  const First = `${Month}-01`;
  const Rows = await Db.execute<{ Date: string; OrdersCount: number; Revenue: string }>(sql`
    WITH Days AS (
      SELECT d::date AS "Day" FROM generate_series(${First}::date, (${First}::date + interval '1 month' - interval '1 day'), interval '1 day') d
    ),
    Local AS (
      SELECT (${Orders.CreatedAt} AT TIME ZONE ${BusinessTimeZone})::date AS "Day", ${Orders.Status} AS "Status", ${Orders.Total} AS "Total"
      FROM ${Orders}
      WHERE ${Orders.CompanyId} = ${CompanyId}
        AND ${Orders.CreatedAt} >= (${First}::date)::timestamp AT TIME ZONE ${BusinessTimeZone}
        AND ${Orders.CreatedAt} < (${First}::date + interval '1 month')::timestamp AT TIME ZONE ${BusinessTimeZone}
    )
    SELECT to_char(Days."Day", 'YYYY-MM-DD') AS "Date",
           count(Local."Day") FILTER (WHERE Local."Status" <> 'Cancelled')::int AS "OrdersCount",
           coalesce(sum(Local."Total") FILTER (WHERE Local."Status" = 'Paid'), 0)::numeric(12,2)::text AS "Revenue"
    FROM Days LEFT JOIN Local ON Local."Day" = Days."Day"
    GROUP BY Days."Day" ORDER BY Days."Day"
  `);
  const Days = Rows.rows.map((R) => ({ Date: R.Date, OrdersCount: Number(R.OrdersCount), Revenue: R.Revenue }));
  const Piasters = Days.reduce((S, D) => S + Math.round(Number(D.Revenue) * 100), 0);
  return {
    Month,
    OrdersCount: Days.reduce((S, D) => S + D.OrdersCount, 0),
    Revenue: `${Math.floor(Piasters / 100)}.${String(Piasters % 100).padStart(2, "0")}`,
    Days,
  };
}
