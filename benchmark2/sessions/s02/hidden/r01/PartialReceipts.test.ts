import { beforeEach, expect, test } from "bun:test";
import { Call, NewCompany, NewProduct, NewPurchaseOrder, NewSupplier, Reset, StockOf } from "../_Support";

let A: Awaited<ReturnType<typeof NewCompany>>;
let Supplier: number;
let P: number[];
let Po: number;

beforeEach(async () => {
  await Reset();
  A = await NewCompany();
  Supplier = await NewSupplier(A.CompanyId, "مورد");
  P = [await NewProduct(A.CompanyId, { Stock: 0 }), await NewProduct(A.CompanyId, { Stock: 0 }), await NewProduct(A.CompanyId, { Stock: 0 })];
  Po = await NewPurchaseOrder(A.Token, Supplier, [
    { ProductId: P[0], Quantity: 10, UnitCost: "5.00" },
    { ProductId: P[1], Quantity: 4, UnitCost: "2.50" },
    { ProductId: P[2], Quantity: 6, UnitCost: "1.00" },
  ]);
});

const Receive = (Lines: { ProductId: number; Quantity: number }[], Id = Po, Token = A.Token) => Call("POST", `/PurchaseOrders/${Id}/Receipts`, { Token, Body: { Lines } });
const Get = async (Id = Po) => (await Call("GET", `/PurchaseOrders/${Id}`, { Token: A.Token })).Body.Data;

test("r01: a partial delivery adds what arrived and marks the order partially received", async () => {
  const Res = await Receive([{ ProductId: P[0], Quantity: 6 }, { ProductId: P[2], Quantity: 6 }]);
  expect(Res.Status).toBe(200);
  expect([await StockOf(P[0]), await StockOf(P[1]), await StockOf(P[2])]).toEqual([6, 0, 6]);
  const Order = await Get();
  expect(Order.Status).toBe("PartiallyReceived");
  const Received = Object.fromEntries(Order.Items.map((I: any) => [I.ProductId, I.ReceivedQuantity]));
  expect(Received).toEqual({ [P[0]]: 6, [P[1]]: 0, [P[2]]: 6 });
});

test("r01: the last delivery completes the order", async () => {
  await Receive([{ ProductId: P[0], Quantity: 6 }]);
  await Receive([{ ProductId: P[0], Quantity: 4 }, { ProductId: P[1], Quantity: 4 }, { ProductId: P[2], Quantity: 6 }]);
  const Order = await Get();
  expect(Order.Status).toBe("Received");
  expect(Order.ReceivedAt).toBeTruthy();
  expect([await StockOf(P[0]), await StockOf(P[1]), await StockOf(P[2])]).toEqual([10, 4, 6]);
});

test("r01: one bad line in a delivery changes nothing at all", async () => {
  await Receive([{ ProductId: P[0], Quantity: 8 }]);
  const Res = await Receive([{ ProductId: P[1], Quantity: 2 }, { ProductId: P[2], Quantity: 3 }, { ProductId: P[0], Quantity: 3 }]);
  expect(Res.Status).toBe(409);
  expect([await StockOf(P[0]), await StockOf(P[1]), await StockOf(P[2])]).toEqual([8, 0, 0]);
  const Received = Object.fromEntries((await Get()).Items.map((I: any) => [I.ProductId, I.ReceivedQuantity]));
  expect(Received).toEqual({ [P[0]]: 8, [P[1]]: 0, [P[2]]: 0 });
});

test("r01: products not on the order and other shops' orders are refused", async () => {
  const Other = await NewProduct(A.CompanyId, { Stock: 0 });
  expect([400, 404, 409]).toContain((await Receive([{ ProductId: P[0], Quantity: 1 }, { ProductId: Other, Quantity: 1 }])).Status);
  expect(await StockOf(P[0])).toBe(0);
  const B = await NewCompany();
  expect((await Receive([{ ProductId: P[0], Quantity: 1 }], Po, B.Token)).Status).toBe(404);
  expect(await StockOf(P[0])).toBe(0);
});
