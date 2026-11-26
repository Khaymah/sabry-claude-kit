import { expect, test } from "bun:test";
import { QueryStats } from "../../../Src/Database/Db";
import { Cancel, Created, InBranch, ListOf, NewCompany, NewProduct, NewWarehouse, Put, Receive, ReportPage, ReportRow, Reset, SendOk } from "../_Support";

test("r08: goods on the road count once, cancelled and received ones do not", async () => {
  await Reset();
  const A = await NewCompany();
  const W1 = await NewWarehouse(A.Token);
  const W2 = await NewWarehouse(A.Token);
  const W3 = await NewWarehouse(A.Token);
  const P = await NewProduct(A.CompanyId);
  const Q = await NewProduct(A.CompanyId);
  await Put(A.Token, W1, P, 10);
  await Put(A.Token, W1, Q, 6);
  await SendOk(A.Token, W1, W2, [{ ProductId: P, Quantity: 3 }, { ProductId: Q, Quantity: 2 }]);
  const T2 = await SendOk(A.Token, W1, W3, [{ ProductId: P, Quantity: 2 }]);
  expect(Created((await Receive(A.Token, T2)).Status)).toBe(true);
  const T3 = await SendOk(A.Token, W1, W2, [{ ProductId: P, Quantity: 1 }]);
  expect(Created((await Cancel(A.Token, T3)).Status)).toBe(true);
  const T4 = await SendOk(A.Token, W1, W3, [{ ProductId: P, Quantity: 1 }, { ProductId: Q, Quantity: 1 }]);
  expect(Created((await Receive(A.Token, T4)).Status)).toBe(true);
  expect(Created((await Cancel(A.Token, T4)).Status)).toBe(true);
  await SendOk(A.Token, W3, W1, [{ ProductId: P, Quantity: 1 }]);
  const Row = await ReportRow(A.Token, P);
  expect(Number(Row.InTransit)).toBe(4);
  expect(Number(Row.TotalQuantity)).toBe(10);
  expect([InBranch(Row, W1), InBranch(Row, W2), InBranch(Row, W3)]).toEqual([5, 0, 1]);
  expect([InBranch(Row, W1, "Incoming"), InBranch(Row, W2, "Incoming"), InBranch(Row, W3, "Incoming")]).toEqual([1, 3, 0]);
  const QRow = await ReportRow(A.Token, Q);
  expect(Number(QRow.InTransit)).toBe(2);
  expect(Number(QRow.TotalQuantity)).toBe(6);
  expect(InBranch(QRow, W1)).toBe(4);
  expect(InBranch(QRow, W2, "Incoming")).toBe(2);
});

test("r08: another company's transfers never show up in the report", async () => {
  await Reset();
  const A = await NewCompany();
  const B = await NewCompany();
  const AW1 = await NewWarehouse(A.Token);
  const AW2 = await NewWarehouse(A.Token);
  const P = await NewProduct(A.CompanyId);
  await Put(A.Token, AW1, P, 5);
  await SendOk(A.Token, AW1, AW2, [{ ProductId: P, Quantity: 2 }]);
  const BW1 = await NewWarehouse(B.Token, "فرع المنافس ١");
  const BW2 = await NewWarehouse(B.Token, "فرع المنافس ٢");
  const BP = await NewProduct(B.CompanyId, { Name: "صنف المنافس" });
  await Put(B.Token, BW1, BP, 40);
  await SendOk(B.Token, BW1, BW2, [{ ProductId: BP, Quantity: 30 }]);
  const Res = await ReportPage(A.Token, 1, 100);
  expect(Res.Status).toBe(200);
  expect(Res.Text).not.toContain("المنافس");
  const Items = ListOf(Res.Body.Data);
  expect(Items.length).toBe(1);
  expect(Number(Items[0].InTransit)).toBe(2);
  expect(Number(Items[0].TotalQuantity)).toBe(5);
  expect(InBranch(Items[0], AW2, "Incoming")).toBe(2);
  const BRow = await ReportRow(B.Token, BP);
  expect(Number(BRow.InTransit)).toBe(30);
  expect(Number(BRow.TotalQuantity)).toBe(40);
});

test("r08: the report with many transfers on the road stays within a small query budget", async () => {
  await Reset();
  const A = await NewCompany();
  const W1 = await NewWarehouse(A.Token);
  const W2 = await NewWarehouse(A.Token);
  const Ps: number[] = [];
  for (let I = 0; I < 110; I++) {
    const P = await NewProduct(A.CompanyId, { Sku: `T-${String(I).padStart(4, "0")}` });
    Ps.push(P);
    await Put(A.Token, W1, P, 5);
  }
  for (let I = 0; I < 110; I += 2) await SendOk(A.Token, W1, W2, [{ ProductId: Ps[I], Quantity: 2 }, { ProductId: Ps[I + 1], Quantity: 1 }]);
  QueryStats.Reset();
  const Res = await ReportPage(A.Token, 1, 100);
  const Queries = QueryStats.Count;
  expect(Res.Status).toBe(200);
  const Items = ListOf(Res.Body.Data);
  expect(Items.length).toBe(100);
  expect(Queries).toBeLessThanOrEqual(8);
  const Row = Items.find((I: any) => I.ProductId === Ps[4]);
  expect(Number(Row.InTransit)).toBe(2);
  expect(Number(Row.TotalQuantity)).toBe(5);
  expect(InBranch(Row, W1)).toBe(3);
  expect(InBranch(Row, W2, "Incoming")).toBe(2);
}, 120000);
