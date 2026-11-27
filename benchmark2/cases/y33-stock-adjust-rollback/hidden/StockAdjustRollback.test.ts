import { beforeEach, expect, test } from "bun:test";
import { Call, NewCompany, NewProduct, Reset, Sql } from "./_Support";

let A: Awaited<ReturnType<typeof NewCompany>>;
let P: number[];

beforeEach(async () => {
  await Reset();
  A = await NewCompany();
  P = [];
  for (const Stock of [10, 10, 2, 10, 10]) P.push(await NewProduct(A.CompanyId, { Stock }));
});

const Adjust = (Lines: unknown[]) => Call("POST", "/Products/StockAdjustments", { Token: A.Token, Body: { Lines } });

async function Snapshot() {
  const Stock = (await Sql<{ Stock: number }>(`SELECT "Stock" FROM "Products" WHERE "CompanyId" = $1 ORDER BY "Id"`, [A.CompanyId])).map((R) => R.Stock);
  const [M] = await Sql<{ N: number }>(`SELECT count(*)::int AS "N" FROM "StockMovements"`);
  return { Stock, Movements: M.N };
}

const Line = (I: number, Change: number) => ({ ProductId: P[I], Change, Reason: "جرد" });

test("a failing third line leaves every product as it was", async () => {
  const Before = await Snapshot();
  const Res = await Adjust([Line(0, -3), Line(1, 4), Line(2, -5), Line(3, 1), Line(4, -1)]);
  expect(Res.Status).toBe(409);
  expect(await Snapshot()).toEqual(Before);
});

test("a foreign product on the third line leaves every product as it was", async () => {
  const B = await NewCompany();
  const Foreign = await NewProduct(B.CompanyId, { Stock: 50 });
  const Before = await Snapshot();
  const Res = await Adjust([Line(0, -3), Line(1, 4), { ProductId: Foreign, Change: -5, Reason: "جرد" }, Line(3, 1)]);
  expect(Res.Status).toBe(404);
  expect(await Snapshot()).toEqual(Before);
  const [F] = await Sql<{ Stock: number }>(`SELECT "Stock" FROM "Products" WHERE "Id" = $1`, [Foreign]);
  expect(F.Stock).toBe(50);
});

test("correcting the bad line and saving again applies each change exactly once", async () => {
  await Adjust([Line(0, -3), Line(1, 4), Line(2, -5), Line(3, 1), Line(4, -1)]);
  const Res = await Adjust([Line(0, -3), Line(1, 4), Line(2, -2), Line(3, 1), Line(4, -1)]);
  expect(Res.Status).toBe(200);
  expect(await Snapshot()).toEqual({ Stock: [7, 14, 0, 11, 9], Movements: 5 });
});

test("two lines for the same product are judged together", async () => {
  const Before = await Snapshot();
  const Res = await Adjust([Line(0, -6), Line(1, 1), Line(0, -6)]);
  expect(Res.Status).toBe(409);
  expect(await Snapshot()).toEqual(Before);
});

test("absurd product ids are refused without a server error and change nothing", async () => {
  const Before = await Snapshot();
  const Res = await Adjust([Line(0, -1), { ProductId: 99999999999, Change: 1, Reason: "x" }]);
  expect([400, 404]).toContain(Res.Status);
  expect(await Snapshot()).toEqual(Before);
});
