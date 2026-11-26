import { expect, test } from "bun:test";
import { QueryStats } from "../../../Src/Database/Db";
import { InBranch, ListOf, NewCompany, NewProduct, NewWarehouse, Put, ReportPage, ReportRow, Reset } from "../_Support";

test("r03: each product shows its quantity per branch and the total, for this company only", async () => {
  await Reset();
  const A = await NewCompany();
  const B = await NewCompany();
  const W1 = await NewWarehouse(A.Token, "فرع ١");
  const W2 = await NewWarehouse(A.Token, "فرع ٢");
  const P1 = await NewProduct(A.CompanyId, { Sku: "A-002", Name: "شاي" });
  const P2 = await NewProduct(A.CompanyId, { Sku: "A-001", Name: "سكر" });
  const P3 = await NewProduct(A.CompanyId, { Sku: "A-003", Name: "رز" });
  await Put(A.Token, W1, P1, 4);
  await Put(A.Token, W2, P1, 6);
  await Put(A.Token, W2, P2, 3);
  const BW = await NewWarehouse(B.Token, "فرع المنافس");
  const BP = await NewProduct(B.CompanyId, { Sku: "A-000", Name: "منتج المنافس" });
  await Put(B.Token, BW, BP, 50);
  const Res = await ReportPage(A.Token, 1, 20);
  expect(Res.Status).toBe(200);
  const Items = ListOf(Res.Body.Data);
  expect(Res.Body.Data.Total).toBe(3);
  expect(Items.map((I: any) => I.Sku)).toEqual(["A-001", "A-002", "A-003"]);
  const R1 = Items.find((I: any) => I.ProductId === P1);
  expect(R1.Name).toBe("شاي");
  expect(Number(R1.TotalQuantity)).toBe(10);
  expect(InBranch(R1, W1)).toBe(4);
  expect(InBranch(R1, W2)).toBe(6);
  const R2 = Items.find((I: any) => I.ProductId === P2);
  expect(Number(R2.TotalQuantity)).toBe(3);
  expect(InBranch(R2, W1)).toBe(0);
  expect(Number((await ReportRow(A.Token, P3)).TotalQuantity)).toBe(0);
  expect(Res.Text).not.toContain("منتج المنافس");
  expect(Res.Text).not.toContain("فرع المنافس");
});

test("r03: a page of the report stays within a small query budget at volume", async () => {
  await Reset();
  const A = await NewCompany();
  const Ws = [await NewWarehouse(A.Token), await NewWarehouse(A.Token), await NewWarehouse(A.Token)];
  const Ps: number[] = [];
  for (let I = 0; I < 130; I++) {
    const P = await NewProduct(A.CompanyId, { Sku: `V-${String(I).padStart(4, "0")}` });
    Ps.push(P);
    await Put(A.Token, Ws[I % 3], P, I + 1);
    if (I % 2 === 0) await Put(A.Token, Ws[(I + 1) % 3], P, 2);
  }
  QueryStats.Reset();
  const Res = await ReportPage(A.Token, 1, 100);
  const Queries = QueryStats.Count;
  expect(Res.Status).toBe(200);
  expect(ListOf(Res.Body.Data).length).toBe(100);
  expect(Queries).toBeLessThanOrEqual(8);
  const Second = ListOf((await ReportPage(A.Token, 2, 100)).Body.Data);
  expect(Second.length).toBe(30);
  const All = [...ListOf(Res.Body.Data), ...Second];
  expect(new Set(All.map((I: any) => I.ProductId)).size).toBe(130);
  const Row = All.find((I: any) => I.ProductId === Ps[10]);
  expect(Number(Row.TotalQuantity)).toBe(13);
  expect(InBranch(Row, Ws[1])).toBe(11);
  expect(InBranch(Row, Ws[2])).toBe(2);
}, 120000);
