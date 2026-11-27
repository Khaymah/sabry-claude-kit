import { beforeEach, expect, test } from "bun:test";
import { Call, NewCompany, NewProduct, NewPurchaseOrder, NewSupplier, Reset } from "../_Support";

beforeEach(async () => {
  await Reset();
});

test("r03: a shop cannot open another shop's purchase order", async () => {
  const A = await NewCompany();
  const B = await NewCompany();
  const Po = await NewPurchaseOrder(A.Token, await NewSupplier(A.CompanyId, "مورد ألفا السري"), [{ ProductId: await NewProduct(A.CompanyId), Quantity: 1, UnitCost: "9.99" }]);
  const Res = await Call("GET", `/PurchaseOrders/${Po}`, { Token: B.Token });
  expect(Res.Status).toBe(404);
  expect(Res.Text).not.toContain("9.99");
  const Own = await Call("GET", `/PurchaseOrders/${Po}`, { Token: A.Token });
  expect(Own.Status).toBe(200);
  expect(Own.Body.Data.Items.length).toBe(1);
});

test("r03: another shop cannot receive a purchase order", async () => {
  const A = await NewCompany();
  const B = await NewCompany();
  const Product = await NewProduct(A.CompanyId, { Stock: 0 });
  const Po = await NewPurchaseOrder(A.Token, await NewSupplier(A.CompanyId), [{ ProductId: Product, Quantity: 2, UnitCost: "1.00" }]);
  expect((await Call("POST", `/PurchaseOrders/${Po}/Receive`, { Token: B.Token })).Status).toBe(404);
});
