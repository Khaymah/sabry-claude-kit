import { expect, test } from "bun:test";
import { Call, Created, MigrateRest, NewCompany, NewProduct, NewWarehouse, Reset, StockOf, Warehouses } from "../_Support";

const Main = "المخزن الرئيسي";

test("r01: a new branch is listed for its company only and starts empty", async () => {
  await Reset();
  const A = await NewCompany();
  const B = await NewCompany();
  const P = await NewProduct(A.CompanyId);
  const Res = await Call("POST", "/Warehouses", { Token: A.Token, Body: { Name: "فرع المعادي" } });
  expect(Created(Res.Status)).toBe(true);
  expect(Res.Body.Data.Name).toBe("فرع المعادي");
  const Id = Res.Body.Data.Id;
  expect((await Warehouses(A.Token)).some((W: any) => W.Id === Id && W.Name === "فرع المعادي")).toBe(true);
  expect((await Warehouses(B.Token)).some((W: any) => W.Id === Id)).toBe(false);
  const Stock = await StockOf(A.Token, Id);
  expect(Stock.Status).toBe(200);
  expect(Stock.Map.get(P) ?? 0).toBe(0);
  expect((await Call("GET", `/Warehouses/${Id}/Stock`, { Token: B.Token })).Status).toBe(404);
});

test("r01: today's product stock becomes the stock of each company's main branch", async () => {
  await Reset("0001_Init");
  const A = await NewCompany();
  const B = await NewCompany();
  const P1 = await NewProduct(A.CompanyId, { Stock: 7 });
  const P2 = await NewProduct(A.CompanyId, { Stock: 0 });
  const P3 = await NewProduct(A.CompanyId, { Stock: 12 });
  const Q1 = await NewProduct(B.CompanyId, { Stock: 5 });
  await MigrateRest();
  const AMain = (await Warehouses(A.Token)).filter((W: any) => W.Name === Main);
  expect(AMain.length).toBe(1);
  const AStock = await StockOf(A.Token, AMain[0].Id);
  expect(AStock.Map.get(P1)).toBe(7);
  expect(AStock.Map.get(P2) ?? 0).toBe(0);
  expect(AStock.Map.get(P3)).toBe(12);
  expect(AStock.Map.has(Q1)).toBe(false);
  const BMain = (await Warehouses(B.Token)).filter((W: any) => W.Name === Main);
  expect(BMain.length).toBe(1);
  expect(BMain[0].Id).not.toBe(AMain[0].Id);
  const BStock = await StockOf(B.Token, BMain[0].Id);
  expect(BStock.Map.get(Q1)).toBe(5);
  expect(BStock.Map.has(P1)).toBe(false);
  const Extra = await NewWarehouse(A.Token);
  expect((await StockOf(A.Token, Extra)).Map.get(P1) ?? 0).toBe(0);
});

test("r01: bad branch input is refused", async () => {
  await Reset();
  const A = await NewCompany();
  for (const Body of [{}, { Name: "" }, { Name: 5 }]) {
    expect((await Call("POST", "/Warehouses", { Token: A.Token, Body })).Status).toBe(400);
  }
  expect([400, 404]).toContain((await Call("GET", "/Warehouses/abc/Stock", { Token: A.Token })).Status);
  expect((await Call("GET", "/Warehouses/999999/Stock", { Token: A.Token })).Status).toBe(404);
  expect((await Call("GET", "/Warehouses")).Status).toBe(401);
});
