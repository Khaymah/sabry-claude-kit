import { beforeEach, expect, test } from "bun:test";
import { Call, NewCompany, NewCustomer, NewOrder, NewProduct, NewUser, Reset, Sql } from "./_Support";

let A: Awaited<ReturnType<typeof NewCompany>>;
let B: Awaited<ReturnType<typeof NewCompany>>;

beforeEach(async () => {
  await Reset();
  A = await NewCompany();
  B = await NewCompany();
});

async function CreateKey(Token = A.Token, Name = "ERP") {
  const Res = await Call("POST", "/ApiKeys", { Token, Body: { Name } });
  expect(Res.Status).toBe(201);
  expect(typeof Res.Body.Data.Key).toBe("string");
  expect(Res.Body.Data.Key.length).toBeGreaterThanOrEqual(24);
  return { Id: Res.Body.Data.Id as number, Key: Res.Body.Data.Key as string };
}

function WithKey(Method: string, Path: string, Key: string, Body?: unknown) {
  return Call(Method, Path, { Body, Headers: { "X-Api-Key": Key } });
}

test("an API key reads only its own company's products and orders", async () => {
  await NewProduct(A.CompanyId, { Name: "منتج أ" });
  const BProduct = await NewProduct(B.CompanyId, { Name: "منتج ب" });
  const BCustomer = await NewCustomer(B.CompanyId);
  const BOrder = await NewOrder(B.CompanyId, BCustomer);
  const { Key } = await CreateKey();
  const Products = await WithKey("GET", "/Products", Key);
  expect(Products.Status).toBe(200);
  expect(Products.Body.Data.Items.map((P: any) => P.Name)).toEqual(["منتج أ"]);
  expect((await WithKey("GET", `/Products/${BProduct}`, Key)).Status).toBe(404);
  expect((await WithKey("GET", `/Orders/${BOrder}`, Key)).Status).toBe(404);
  const Orders = await WithKey("GET", "/Orders", Key);
  expect(Orders.Status).toBe(200);
  expect(Orders.Body.Data.Items).toEqual([]);
});

test("an API key creates orders in its own company only", async () => {
  const { Key } = await CreateKey();
  const Customer = await NewCustomer(A.CompanyId);
  const Product = await NewProduct(A.CompanyId, { Stock: 5 });
  const BCustomer = await NewCustomer(B.CompanyId);
  const Created = await WithKey("POST", "/Orders", Key, { CustomerId: Customer, Items: [{ ProductId: Product, Quantity: 1 }] });
  expect(Created.Status).toBe(201);
  const [Row] = await Sql<{ CompanyId: number }>(`SELECT "CompanyId" FROM "Orders" WHERE "Id" = $1`, [Created.Body.Data.Id]);
  expect(Row.CompanyId).toBe(A.CompanyId);
  const Foreign = await WithKey("POST", "/Orders", Key, { CustomerId: BCustomer, Items: [{ ProductId: Product, Quantity: 1 }] });
  expect(Foreign.Status).toBe(404);
});

test("an API key cannot reach admin, payment or write endpoints outside orders", async () => {
  const { Key } = await CreateKey();
  const Product = await NewProduct(A.CompanyId);
  const Customer = await NewCustomer(A.CompanyId);
  const Order = await NewOrder(A.CompanyId, Customer);
  const Attempts: [string, string, unknown?][] = [
    ["GET", "/Users"],
    ["POST", "/Users", { Email: "x@example.com", Name: "X", Password: "Password123!", Role: "Admin" }],
    ["GET", "/ApiKeys"],
    ["POST", "/ApiKeys", { Name: "more" }],
    ["POST", "/Payments", { OrderId: Order, Amount: "1.00", Method: "Cash" }],
    ["PATCH", `/Products/${Product}`, { Price: "0.01" }],
    ["POST", `/Orders/${Order}/Cancel`],
    ["GET", "/Customers"],
  ];
  for (const [Method, Path, Body] of Attempts) {
    const Res = await WithKey(Method, Path, Key, Body);
    expect([Method, Path, Res.Status]).toEqual([Method, Path, 403]);
  }
  const [P] = await Sql<{ Price: string }>(`SELECT "Price"::text AS "Price" FROM "Products" WHERE "Id" = $1`, [Product]);
  expect(P.Price).toBe("100.00");
  const [Count] = await Sql<{ N: number }>(`SELECT count(*)::int AS "N" FROM "Payments"`);
  expect(Count.N).toBe(0);
});

test("a revoked key stops working and other companies cannot revoke it", async () => {
  const { Id, Key } = await CreateKey();
  expect((await Call("DELETE", `/ApiKeys/${Id}`, { Token: B.Token })).Status).toBe(404);
  expect((await WithKey("GET", "/Products", Key)).Status).toBe(200);
  expect((await Call("DELETE", `/ApiKeys/${Id}`, { Token: A.Token })).Status).toBe(200);
  expect((await WithKey("GET", "/Products", Key)).Status).toBe(401);
  expect((await WithKey("GET", "/Products", "sk_totally_made_up_key_123456")).Status).toBe(401);
});

test("only the owner manages keys and the secret is shown only once", async () => {
  const Admin = await NewUser(A.CompanyId, "Admin");
  const Staff = await NewUser(A.CompanyId, "Staff");
  expect((await Call("POST", "/ApiKeys", { Token: Admin.Token, Body: { Name: "x" } })).Status).toBe(403);
  expect((await Call("POST", "/ApiKeys", { Token: Staff.Token, Body: { Name: "x" } })).Status).toBe(403);
  const { Key } = await CreateKey();
  await CreateKey(B.Token, "B key");
  const List = await Call("GET", "/ApiKeys", { Token: A.Token });
  expect(List.Status).toBe(200);
  expect(List.Body.Data.length).toBe(1);
  expect(List.Text).not.toContain(Key);
  expect(List.Text).not.toContain("B key");
});

test("the raw key is never stored", async () => {
  const { Key } = await CreateKey();
  const Tables = await Sql<{ table_name: string }>(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`);
  for (const T of Tables) {
    const Rows = await Sql<{ J: string }>(`SELECT row_to_json(t)::text AS "J" FROM "${T.table_name}" t`);
    for (const R of Rows) expect(R.J.includes(Key)).toBe(false);
  }
});

test("user sessions keep working as before", async () => {
  await CreateKey();
  expect((await Call("GET", "/Users", { Token: A.Token })).Status).toBe(200);
  expect((await Call("GET", "/Customers", { Token: A.Token })).Status).toBe(200);
  expect((await Call("GET", "/Products")).Status).toBe(401);
});
