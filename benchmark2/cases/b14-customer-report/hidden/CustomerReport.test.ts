import { beforeAll, expect, test } from "bun:test";
import { QueryStats } from "../../Src/Database/Db";
import { Call, NewCompany, NewCustomer, Reset, Sql } from "./_Support";

const CustomersCount = 3000;
let A: Awaited<ReturnType<typeof NewCompany>>;
let B: Awaited<ReturnType<typeof NewCompany>>;
let Truth: Map<number, { OrdersCount: number; TotalSpent: string; LastOrderAt: number | null; Name: string }>;

beforeAll(async () => {
  await Reset();
  A = await NewCompany();
  B = await NewCompany();
  await Sql(`INSERT INTO "Customers" ("CompanyId","Name") SELECT $1, 'عميل ' || g FROM generate_series(1, ${CustomersCount}) g`, [A.CompanyId]);
  const Ids = (await Sql<{ Id: number }>(`SELECT "Id" FROM "Customers" WHERE "CompanyId" = $1 ORDER BY "Id"`, [A.CompanyId])).map((R) => R.Id);
  await Sql(
    `INSERT INTO "Orders" ("CompanyId","CustomerId","Status","Subtotal","Tax","Total","CreatedAt")
     SELECT $1, ($2::int[])[1 + ((g * 7919) % 2500)],
            CASE WHEN g % 10 = 0 THEN 'Cancelled' WHEN g % 3 = 0 THEN 'Pending' ELSE 'Paid' END,
            '0.00', '0.00', ((g % 997) + 1)::numeric / 10,
            timestamptz '2026-01-01 00:00:00+00' + g * interval '1 minute'
     FROM generate_series(1, 30000) g`,
    [A.CompanyId, Ids],
  );
  const BCustomer = await NewCustomer(B.CompanyId, { Name: "منافس" });
  await Sql(`INSERT INTO "Orders" ("CompanyId","CustomerId","Status","Subtotal","Tax","Total") SELECT $1, $2, 'Paid', '0', '0', '99999.00' FROM generate_series(1, 5)`, [B.CompanyId, BCustomer]);
  const Rows = await Sql<any>(
    `SELECT c."Id", c."Name",
            count(o."Id") FILTER (WHERE o."Status" <> 'Cancelled')::int AS "OrdersCount",
            coalesce(sum(o."Total") FILTER (WHERE o."Status" = 'Paid'), 0)::numeric(12,2)::text AS "TotalSpent",
            extract(epoch from max(o."CreatedAt") FILTER (WHERE o."Status" <> 'Cancelled')) * 1000 AS "Last"
     FROM "Customers" c LEFT JOIN "Orders" o ON o."CustomerId" = c."Id"
     WHERE c."CompanyId" = $1 GROUP BY c."Id"`,
    [A.CompanyId],
  );
  Truth = new Map(Rows.map((R) => [R.Id, { Name: R.Name, OrdersCount: R.OrdersCount, TotalSpent: R.TotalSpent, LastOrderAt: R.Last === null ? null : Math.round(Number(R.Last)) }]));
}, 120000);

async function Report(Query: string, Token = A.Token) {
  QueryStats.Reset();
  const Res = await Call("GET", `/Reports/Customers?${Query}`, { Token });
  return { Res, Queries: QueryStats.Count };
}

const Cents = (V: string) => Math.round(Number(V) * 100);

test("a page of the report costs a small constant number of queries", async () => {
  const Big = await Report("Page=2&PageSize=100");
  expect(Big.Res.Status).toBe(200);
  expect(Big.Res.Body.Data.Items.length).toBe(100);
  expect(Big.Queries).toBeLessThanOrEqual(4);
  const Small = await Report("Page=1&PageSize=5");
  expect(Small.Res.Body.Data.Items.length).toBe(5);
  expect(Small.Queries).toBeLessThanOrEqual(4);
});

test("every row matches the orders exactly", async () => {
  for (const Page of [1, 2, 26, 30]) {
    const { Res } = await Report(`Page=${Page}&PageSize=100`);
    for (const Row of Res.Body.Data.Items) {
      const T = Truth.get(Row.CustomerId)!;
      expect(T).toBeDefined();
      expect(Row.Name).toBe(T.Name);
      expect(Row.OrdersCount).toBe(T.OrdersCount);
      expect(Row.TotalSpent).toBe(T.TotalSpent);
      if (T.LastOrderAt === null) expect(Row.LastOrderAt).toBeNull();
      else expect(new Date(Row.LastOrderAt).getTime()).toBe(T.LastOrderAt);
    }
  }
});

test("paging covers every customer once, ordered by spend then id", async () => {
  const All: any[] = [];
  for (let Page = 1; Page <= CustomersCount / 100; Page++) {
    const { Res } = await Report(`Page=${Page}&PageSize=100`);
    All.push(...Res.Body.Data.Items);
  }
  expect(All.length).toBe(CustomersCount);
  expect(new Set(All.map((R) => R.CustomerId)).size).toBe(CustomersCount);
  for (let I = 1; I < All.length; I++) {
    const Prev = Cents(All[I - 1].TotalSpent);
    const Cur = Cents(All[I].TotalSpent);
    expect(Prev > Cur || (Prev === Cur && All[I - 1].CustomerId < All[I].CustomerId)).toBe(true);
  }
  const Zero = All.filter((R) => R.OrdersCount === 0);
  expect(Zero.length).toBe([...Truth.values()].filter((T) => T.OrdersCount === 0).length);
  expect(Zero.length).toBeGreaterThanOrEqual(500);
  expect(Zero.every((R) => R.TotalSpent === "0.00" && R.LastOrderAt === null)).toBe(true);
}, 60000);

test("the report only covers the caller's company", async () => {
  const { Res } = await Report("Page=1&PageSize=100");
  expect(Res.Body.Data.Total).toBe(CustomersCount);
  expect(Res.Text).not.toContain("منافس");
  const Other = await Report("Page=1&PageSize=10", B.Token);
  expect(Other.Res.Body.Data.Total).toBe(1);
  expect(Other.Res.Body.Data.Items[0].TotalSpent).toBe("499995.00");
});
