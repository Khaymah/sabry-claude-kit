import { beforeEach, expect, test } from "bun:test";
import { Call, NewCompany, NewCustomer, NewOrder, NewProduct, Reset, Sql } from "./_Support";

let A: Awaited<ReturnType<typeof NewCompany>>;
let B: Awaited<ReturnType<typeof NewCompany>>;
let ACustomer: number;
let BCustomer: number;
let AProduct: number;
let BProduct: number;
let BOrder: number;

beforeEach(async () => {
  await Reset();
  A = await NewCompany("Alpha");
  B = await NewCompany("Beta");
  ACustomer = await NewCustomer(A.CompanyId, { Name: "عميل ألفا" });
  BCustomer = await NewCustomer(B.CompanyId, { Name: "عميل بيتا" });
  AProduct = await NewProduct(A.CompanyId, { Name: "Alpha Widget", Price: "10.00", Stock: 10 });
  BProduct = await NewProduct(B.CompanyId, { Name: "Beta Secret", Price: "1.00", Stock: 10 });
  BOrder = await NewOrder(B.CompanyId, BCustomer, "114.00");
  await Sql(`INSERT INTO "OrderItems" ("OrderId","ProductId","Quantity","UnitPrice","LineTotal") VALUES ($1,$2,1,'100.00','100.00')`, [BOrder, BProduct]);
  await Sql(`INSERT INTO "Payments" ("CompanyId","OrderId","Amount","Method") VALUES ($1,$2,'14.00','Cash')`, [B.CompanyId, BOrder]);
});

test("another company's order cannot be read", async () => {
  const Res = await Call("GET", `/Orders/${BOrder}`, { Token: A.Token });
  expect(Res.Status).toBe(404);
  expect(Res.Text).not.toContain("عميل بيتا");
});

test("another company's payments are not listed", async () => {
  const Res = await Call("GET", `/Payments?OrderId=${BOrder}`, { Token: A.Token });
  expect([200, 404]).toContain(Res.Status);
  if (Res.Status === 200) expect(Res.Body.Data).toEqual([]);
});

test("another company's product cannot be edited", async () => {
  const Res = await Call("PATCH", `/Products/${BProduct}`, { Token: A.Token, Body: { Price: "0.01", Name: "hacked" } });
  expect(Res.Status).toBe(404);
  const [Row] = await Sql(`SELECT "Name", "Price"::text AS "Price" FROM "Products" WHERE "Id" = $1`, [BProduct]);
  expect(Row).toEqual({ Name: "Beta Secret", Price: "1.00" });
});

test("an order cannot use another company's product", async () => {
  const Res = await Call("POST", "/Orders", { Token: A.Token, Body: { CustomerId: ACustomer, Items: [{ ProductId: BProduct, Quantity: 2 }] } });
  expect(Res.Status).toBe(404);
  const [Row] = await Sql<{ Stock: number }>(`SELECT "Stock" FROM "Products" WHERE "Id" = $1`, [BProduct]);
  expect(Row.Stock).toBe(10);
  const [Count] = await Sql<{ N: number }>(`SELECT count(*)::int AS "N" FROM "Orders" WHERE "CompanyId" = $1`, [A.CompanyId]);
  expect(Count.N).toBe(0);
});

test("another company's order cannot be cancelled", async () => {
  const Res = await Call("POST", `/Orders/${BOrder}/Cancel`, { Token: A.Token });
  expect(Res.Status).toBe(404);
  const [Row] = await Sql<{ Status: string }>(`SELECT "Status" FROM "Orders" WHERE "Id" = $1`, [BOrder]);
  expect(Row.Status).toBe("Pending");
  const [P] = await Sql<{ Stock: number }>(`SELECT "Stock" FROM "Products" WHERE "Id" = $1`, [BProduct]);
  expect(P.Stock).toBe(10);
});

test("another company's order cannot be paid", async () => {
  const Res = await Call("POST", "/Payments", { Token: A.Token, Body: { OrderId: BOrder, Amount: "100.00", Method: "Cash" } });
  expect(Res.Status).toBe(404);
  const [Count] = await Sql<{ N: number }>(`SELECT count(*)::int AS "N" FROM "Payments" WHERE "OrderId" = $1`, [BOrder]);
  expect(Count.N).toBe(1);
});

test("an order cannot reference another company's customer", async () => {
  const Res = await Call("POST", "/Orders", { Token: A.Token, Body: { CustomerId: BCustomer, Items: [{ ProductId: AProduct, Quantity: 1 }] } });
  expect(Res.Status).toBe(404);
});

test("each company still works normally with its own data", async () => {
  const Created = await Call("POST", "/Orders", { Token: A.Token, Body: { CustomerId: ACustomer, Items: [{ ProductId: AProduct, Quantity: 2 }] } });
  expect(Created.Status).toBe(201);
  const Id = Created.Body.Data.Id;
  expect((await Call("GET", `/Orders/${Id}`, { Token: A.Token })).Status).toBe(200);
  const Paid = await Call("POST", "/Payments", { Token: A.Token, Body: { OrderId: Id, Amount: Created.Body.Data.Total, Method: "Cash" } });
  expect(Paid.Status).toBe(201);
  const Listed = await Call("GET", `/Payments?OrderId=${Id}`, { Token: A.Token });
  expect(Listed.Body.Data.length).toBe(1);
  expect((await Call("PATCH", `/Products/${AProduct}`, { Token: A.Token, Body: { Price: "12.00" } })).Status).toBe(200);
  expect((await Call("GET", `/Orders/${BOrder}`, { Token: B.Token })).Status).toBe(200);
  expect((await Call("POST", `/Orders/${BOrder}/Cancel`, { Token: B.Token })).Status).toBe(200);
  const List = await Call("GET", "/Orders", { Token: A.Token });
  expect(List.Body.Data.Items.map((O: any) => O.Id)).toEqual([Id]);
});
