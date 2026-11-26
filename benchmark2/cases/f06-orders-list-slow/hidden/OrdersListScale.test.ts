import { beforeAll, expect, test } from "bun:test";
import { QueryStats } from "../../Src/Database/Db";
import { Call, NewCompany, NewCustomer, NewProduct, Reset, Sql } from "./_Support";

const OrdersCount = 2000;
let A: Awaited<ReturnType<typeof NewCompany>>;
let B: Awaited<ReturnType<typeof NewCompany>>;

beforeAll(async () => {
  await Reset();
  A = await NewCompany();
  B = await NewCompany();
  const Customers = [];
  for (let I = 0; I < 20; I++) Customers.push(await NewCustomer(A.CompanyId, { Name: `عميل ${I}` }));
  const P1 = await NewProduct(A.CompanyId, { Price: "10.00" });
  const P2 = await NewProduct(A.CompanyId, { Price: "5.00" });
  await Sql(
    `INSERT INTO "Orders" ("CompanyId","CustomerId","Status","Subtotal","Tax","Total","CreatedAt")
     SELECT $1, ($2::int[])[1 + (g % 20)], 'Pending', '15.00', '2.10', '17.10', timestamptz '2026-01-01 10:00:00+00' + ((g / 500) * interval '1 hour')
     FROM generate_series(1, ${OrdersCount}) g`,
    [A.CompanyId, Customers],
  );
  await Sql(
    `INSERT INTO "OrderItems" ("OrderId","ProductId","Quantity","UnitPrice","LineTotal")
     SELECT o."Id", p.pid, 1, p.price, p.price FROM "Orders" o
     CROSS JOIN (VALUES ($1::int, 10.00::numeric), ($2::int, 5.00::numeric)) AS p(pid, price)`,
    [P1, P2],
  );
  const BCustomer = await NewCustomer(B.CompanyId);
  await Sql(
    `INSERT INTO "Orders" ("CompanyId","CustomerId","Status","Subtotal","Tax","Total") SELECT $1, $2, 'Pending', '1.00', '0.14', '1.14' FROM generate_series(1, 30)`,
    [B.CompanyId, BCustomer],
  );
}, 120000);

async function Counted(Path: string, Token: string) {
  QueryStats.Reset();
  const Res = await Call("GET", Path, { Token });
  return { Res, Queries: QueryStats.Count };
}

test("a page of 100 orders uses a small constant number of queries", async () => {
  const { Res, Queries } = await Counted("/Orders?Page=3&PageSize=100", A.Token);
  expect(Res.Status).toBe(200);
  expect(Res.Body.Data.Items.length).toBe(100);
  expect(Queries).toBeLessThanOrEqual(6);
});

test("query count does not grow with page size", async () => {
  const Small = await Counted("/Orders?Page=1&PageSize=5", A.Token);
  const Large = await Counted("/Orders?Page=20&PageSize=100", A.Token);
  expect(Small.Queries).toBeLessThanOrEqual(6);
  expect(Large.Queries).toBeLessThanOrEqual(6);
  expect(Large.Res.Body.Data.Items.length).toBe(100);
});

test("paging through every page returns each order exactly once", async () => {
  const Seen: number[] = [];
  for (let Page = 1; Page <= OrdersCount / 100; Page++) {
    const Res = await Call("GET", `/Orders?Page=${Page}&PageSize=100`, { Token: A.Token });
    expect(Res.Status).toBe(200);
    Seen.push(...Res.Body.Data.Items.map((O: any) => O.Id));
  }
  expect(Seen.length).toBe(OrdersCount);
  expect(new Set(Seen).size).toBe(OrdersCount);
}, 60000);

test("orders are newest first and each row keeps its customer and lines", async () => {
  const Res = await Call("GET", "/Orders?Page=1&PageSize=50", { Token: A.Token });
  const Items = Res.Body.Data.Items;
  for (let I = 1; I < Items.length; I++) expect(new Date(Items[I - 1].CreatedAt).getTime()).toBeGreaterThanOrEqual(new Date(Items[I].CreatedAt).getTime());
  for (const O of Items) {
    expect(O.Customer.Name).toMatch(/^عميل \d+$/);
    expect(O.Items.length).toBe(2);
    expect(O.Items.map((L: any) => L.LineTotal).sort()).toEqual(["10.00", "5.00"]);
    expect(O.Total).toBe("17.10");
  }
  expect(Res.Body.Data.Total).toBe(OrdersCount);
  expect(Res.Body.Data.TotalPages).toBe(40);
});

test("other companies' orders are not counted or listed", async () => {
  const Res = await Call("GET", "/Orders?Page=1&PageSize=100", { Token: B.Token });
  expect(Res.Body.Data.Total).toBe(30);
  expect(Res.Body.Data.Items.length).toBe(30);
});
