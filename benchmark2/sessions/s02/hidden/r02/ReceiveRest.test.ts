import { beforeEach, expect, test } from "bun:test";
import { Call, NewCompany, NewProduct, NewPurchaseOrder, NewSupplier, Reset, StockOf } from "../_Support";

let A: Awaited<ReturnType<typeof NewCompany>>;

beforeEach(async () => {
  await Reset();
  A = await NewCompany();
});

test("r02: the old receive button receives only what is still missing", async () => {
  const Supplier = await NewSupplier(A.CompanyId);
  const P1 = await NewProduct(A.CompanyId, { Stock: 1 });
  const P2 = await NewProduct(A.CompanyId, { Stock: 1 });
  const Po = await NewPurchaseOrder(A.Token, Supplier, [{ ProductId: P1, Quantity: 10, UnitCost: "1.00" }, { ProductId: P2, Quantity: 5, UnitCost: "1.00" }]);
  expect((await Call("POST", `/PurchaseOrders/${Po}/Receipts`, { Token: A.Token, Body: { Lines: [{ ProductId: P1, Quantity: 7 }] } })).Status).toBe(200);
  expect((await Call("POST", `/PurchaseOrders/${Po}/Receive`, { Token: A.Token })).Status).toBe(200);
  expect([await StockOf(P1), await StockOf(P2)]).toEqual([11, 6]);
  expect((await Call("GET", `/PurchaseOrders/${Po}`, { Token: A.Token })).Body.Data.Status).toBe("Received");
  expect((await Call("POST", `/PurchaseOrders/${Po}/Receive`, { Token: A.Token })).Status).toBe(409);
  expect((await Call("POST", `/PurchaseOrders/${Po}/Receipts`, { Token: A.Token, Body: { Lines: [{ ProductId: P1, Quantity: 1 }] } })).Status).toBe(409);
  expect([await StockOf(P1), await StockOf(P2)]).toEqual([11, 6]);
});

test("r02: receiving a whole order in one go still works as before", async () => {
  const Supplier = await NewSupplier(A.CompanyId);
  const P1 = await NewProduct(A.CompanyId, { Stock: 0 });
  const Po = await NewPurchaseOrder(A.Token, Supplier, [{ ProductId: P1, Quantity: 3, UnitCost: "4.00" }]);
  expect((await Call("POST", `/PurchaseOrders/${Po}/Receive`, { Token: A.Token })).Status).toBe(200);
  expect(await StockOf(P1)).toBe(3);
});
