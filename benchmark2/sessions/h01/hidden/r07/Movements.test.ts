import { expect, test } from "bun:test";
import { Adjust, Cancel, Created, MigrateRest, Movements, NewCompany, NewProduct, NewWarehouse, Put, Qty, Receive, Reset, SendOk, Stocktake, Warehouses } from "../_Support";

const Shape = (Items: any[]) => Items.map((I: any) => [I.Type, Number(I.Change), Number(I.Balance)]);
const Back = (Change: number, Type: string) => (Type === "TransferCancel" ? (Change > 0 ? "TransferIn" : "TransferOut") : Type);
const Loose = (Items: any[]) => Items.map((I: any) => [Back(Number(I.Change), I.Type), Number(I.Change), Number(I.Balance)]);

test("r07: the ledger of a branch reconciles every kind of movement", async () => {
  await Reset();
  const A = await NewCompany();
  const W1 = await NewWarehouse(A.Token);
  const W2 = await NewWarehouse(A.Token);
  const P = await NewProduct(A.CompanyId);
  const Other = await NewProduct(A.CompanyId);
  await Put(A.Token, W1, P, 10);
  await Put(A.Token, W1, Other, 3);
  const T = await SendOk(A.Token, W1, W2, [{ ProductId: P, Quantity: 4 }, { ProductId: Other, Quantity: 1 }]);
  expect(Created((await Receive(A.Token, T)).Status)).toBe(true);
  expect(Created((await Stocktake(A.Token, W1, [{ ProductId: P, Counted: 5 }])).Status)).toBe(true);
  expect(Created((await Cancel(A.Token, T)).Status)).toBe(true);
  expect(Created((await Adjust(A.Token, W1, P, -2)).Status)).toBe(true);
  const M1 = await Movements(A.Token, W1, P);
  expect(M1.Status).toBe(200);
  expect(Loose(M1.Items)).toEqual([
    ["Adjustment", 10, 10],
    ["TransferOut", -4, 6],
    ["Stocktake", -1, 5],
    ["TransferIn", 4, 9],
    ["Adjustment", -2, 7],
  ]);
  expect(M1.Items[3].Type === "TransferCancel" || M1.Items[3].Type === "TransferIn").toBe(true);
  expect(await Qty(A.Token, W1, P)).toBe(7);
  const M2 = await Movements(A.Token, W2, P);
  expect(Loose(M2.Items)).toEqual([
    ["TransferIn", 4, 4],
    ["TransferOut", -4, 0],
  ]);
  const MO = await Movements(A.Token, W1, Other);
  expect(Loose(MO.Items)).toEqual([
    ["Adjustment", 3, 3],
    ["TransferOut", -1, 2],
    ["TransferIn", 1, 3],
  ]);
});

test("r07: stock that existed before branches opens the main branch's ledger", async () => {
  await Reset("0001_Init");
  const A = await NewCompany();
  const P = await NewProduct(A.CompanyId, { Stock: 7 });
  await MigrateRest();
  const Main = (await Warehouses(A.Token)).find((W: any) => W.Name === "المخزن الرئيسي");
  const Before = await Movements(A.Token, Main.Id, P);
  expect(Before.Status).toBe(200);
  expect(Shape(Before.Items)).toEqual([["Opening", 7, 7]]);
  expect(Created((await Adjust(A.Token, Main.Id, P, -2)).Status)).toBe(true);
  const After = await Movements(A.Token, Main.Id, P);
  expect(Shape(After.Items)).toEqual([
    ["Opening", 7, 7],
    ["Adjustment", -2, 5],
  ]);
});

test("r07: another company's ledger is not reachable and bad ids are refused", async () => {
  await Reset();
  const A = await NewCompany();
  const B = await NewCompany();
  const W = await NewWarehouse(A.Token);
  const P = await NewProduct(A.CompanyId);
  const BP = await NewProduct(B.CompanyId);
  await Put(A.Token, W, P, 5);
  const Foreign = await Movements(B.Token, W, P);
  expect(Foreign.Status).toBe(404);
  expect(Foreign.Res.Text).not.toContain("Adjustment");
  const OtherProduct = await Movements(A.Token, W, BP);
  expect(OtherProduct.Status === 404 || (OtherProduct.Status === 200 && OtherProduct.Items.length === 0)).toBe(true);
  for (const Id of ["abc", "-3", "99999999999"]) {
    const Res = await Movements(A.Token, W, Id as any);
    expect(Res.Status === 400 || Res.Status === 404 || (Res.Status === 200 && Res.Items.length === 0)).toBe(true);
  }
});
