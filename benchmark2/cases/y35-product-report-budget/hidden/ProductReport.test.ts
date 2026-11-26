import { beforeAll, expect, test } from "bun:test";
import { QueryStats } from "../../Src/Database/Db";
import { Call, NewCompany, NewCustomer, NewProduct, Reset, Sql } from "./_Support";

const ProductsCount = 600;
let A: Awaited<ReturnType<typeof NewCompany>>;
let B: Awaited<ReturnType<typeof NewCompany>>;
let Truth: Map<number, { SoldQuantity: number; Revenue: string; LastSoldAt: number | null }>;

beforeAll(async () => {
  await Reset();
  A = await NewCompany();
  B = await NewCompany();
  const Customer = await NewCustomer(A.CompanyId);
  await Sql(`INSERT INTO "Products" ("CompanyId","Name","Sku","Price","Stock") SELECT $1, 'منتج ' || g, 'S' || g, '1.00', g % 40 FROM generate_series(1, ${ProductsCount}) g`, [A.CompanyId]);
  const Ids = (await Sql<{ Id: number }>(`SELECT "Id" FROM "Products" WHERE "CompanyId" = $1 ORDER BY "Id"`, [A.CompanyId])).map((R) => R.Id);
  await Sql(
    `INSERT INTO "Orders" ("CompanyId","CustomerId","Status","Subtotal","Tax","Total","CreatedAt")
     SELECT $1, $2, CASE WHEN g % 7 = 0 THEN 'Cancelled' WHEN g % 4 = 0 THEN 'Pending' ELSE 'Paid' END, '0', '0', '0', timestamptz '2026-01-01' + g * interval '5 minutes'
     FROM generate_series(1, 10000) g`,
    [A.CompanyId, Customer],
  );
  await Sql(
    `INSERT INTO "OrderItems" ("OrderId","ProductId","Quantity","UnitPrice","LineTotal")
     SELECT o."Id", ($1::int[])[1 + ((o."Id" * 31 + k * 17) % 500)], 1 + (k % 3), '0.10', ((1 + (k % 3)) * 0.10)::numeric(12,2)
     FROM "Orders" o CROSS JOIN generate_series(0, 2) k WHERE o."CompanyId" = $2`,
    [Ids, A.CompanyId],
  );
  const BProduct = await NewProduct(B.CompanyId, { Name: "منافس" });
  const BC = await NewCustomer(B.CompanyId);
  const [BO] = await Sql<{ Id: number }>(`INSERT INTO "Orders" ("CompanyId","CustomerId","Status","Subtotal","Tax","Total") VALUES ($1,$2,'Paid','0','0','0') RETURNING "Id"`, [B.CompanyId, BC]);
  await Sql(`INSERT INTO "OrderItems" ("OrderId","ProductId","Quantity","UnitPrice","LineTotal") VALUES ($1,$2,5,'1000.00','5000.00')`, [BO.Id, BProduct]);
  const Rows = await Sql<any>(
    `SELECT p."Id",
            coalesce(sum(i."Quantity") FILTER (WHERE o."Status" <> 'Cancelled'), 0)::int AS "Sold",
            coalesce(sum(i."LineTotal") FILTER (WHERE o."Status" = 'Paid'), 0)::numeric(12,2)::text AS "Revenue",
            extract(epoch from max(o."CreatedAt") FILTER (WHERE o."Status" <> 'Cancelled')) * 1000 AS "Last"
     FROM "Products" p LEFT JOIN "OrderItems" i ON i."ProductId" = p."Id" LEFT JOIN "Orders" o ON o."Id" = i."OrderId"
     WHERE p."CompanyId" = $1 GROUP BY p."Id"`,
    [A.CompanyId],
  );
  Truth = new Map(Rows.map((R) => [R.Id, { SoldQuantity: R.Sold, Revenue: R.Revenue, LastSoldAt: R.Last === null ? null : Math.round(Number(R.Last)) }]));
}, 120000);

async function Report(Query: string, Token = A.Token) {
  QueryStats.Reset();
  const Res = await Call("GET", `/Reports/Products?${Query}`, { Token });
  return { Res, Queries: QueryStats.Count };
}

test("a page of the product report stays within a small query budget", async () => {
  const Big = await Report("Page=3&PageSize=100");
  expect(Big.Res.Status).toBe(200);
  expect(Big.Res.Body.Data.Items.length).toBe(100);
  expect(Big.Queries).toBeLessThanOrEqual(5);
  const Small = await Report("Page=1&PageSize=5");
  expect(Small.Res.Body.Data.Items.length).toBe(5);
  expect(Small.Queries).toBeLessThanOrEqual(5);
});

test("sold quantities leave out cancelled orders and revenue counts paid orders only", async () => {
  for (const Page of [1, 3, 6]) {
    const { Res } = await Report(`Page=${Page}&PageSize=100`);
    for (const Row of Res.Body.Data.Items) {
      const T = Truth.get(Row.ProductId)!;
      expect(T).toBeDefined();
      expect(Row.SoldQuantity).toBe(T.SoldQuantity);
      expect(Row.Revenue).toBe(T.Revenue);
      if (T.LastSoldAt === null) expect(Row.LastSoldAt).toBeNull();
      else expect(new Date(Row.LastSoldAt).getTime()).toBe(T.LastSoldAt);
    }
  }
});

test("paging covers every product once, best sellers first", async () => {
  const All: any[] = [];
  for (let Page = 1; Page <= ProductsCount / 100; Page++) All.push(...(await Report(`Page=${Page}&PageSize=100`)).Res.Body.Data.Items);
  expect(new Set(All.map((R) => R.ProductId)).size).toBe(ProductsCount);
  for (let I = 1; I < All.length; I++) {
    const P = Number(All[I - 1].Revenue);
    const C = Number(All[I].Revenue);
    expect([I, P > C || (P === C && All[I - 1].ProductId < All[I].ProductId)]).toEqual([I, true]);
  }
}, 60000);

test("other companies' products and sales stay out", async () => {
  const { Res } = await Report("Page=1&PageSize=10");
  expect(Res.Body.Data.Total).toBe(ProductsCount);
  expect(Res.Text).not.toContain("منافس");
});
