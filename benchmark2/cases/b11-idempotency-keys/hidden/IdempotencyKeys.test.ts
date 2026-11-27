import { afterEach, beforeEach, expect, setSystemTime, test } from "bun:test";
import { Call, NewCompany, NewCustomer, NewOrder, NewProduct, Reset, Sql } from "./_Support";

let A: Awaited<ReturnType<typeof NewCompany>>;
let Customer: number;
let Product: number;

beforeEach(async () => {
  await Reset();
  A = await NewCompany();
  Customer = await NewCustomer(A.CompanyId);
  Product = await NewProduct(A.CompanyId, { Stock: 50, Price: "10.00" });
});

afterEach(() => {
  setSystemTime();
});

function PostOrder(Key: string | null, Quantity = 1, Token = A.Token, CustomerId = Customer, ProductId = Product) {
  return Call("POST", "/Orders", {
    Token,
    Body: { CustomerId, Items: [{ ProductId, Quantity }] },
    Headers: Key === null ? {} : { "Idempotency-Key": Key },
  });
}

async function Count(Table: string) {
  const [Row] = await Sql<{ N: number }>(`SELECT count(*)::int AS "N" FROM "${Table}"`);
  return Row.N;
}

async function Stock() {
  const [Row] = await Sql<{ Stock: number }>(`SELECT "Stock" FROM "Products" WHERE "Id" = $1`, [Product]);
  return Row.Stock;
}

test("retrying an order with the same key replays the first response", async () => {
  const First = await PostOrder("key-1", 2);
  const Retry = await PostOrder("key-1", 2);
  expect(First.Status).toBe(201);
  expect(Retry.Status).toBe(201);
  expect(Retry.Body).toEqual(First.Body);
  expect(await Count("Orders")).toBe(1);
  expect(await Stock()).toBe(48);
});

test("reusing a key for a different request is refused", async () => {
  expect((await PostOrder("key-2", 1)).Status).toBe(201);
  const Other = await PostOrder("key-2", 3);
  expect(Other.Status).toBe(422);
  expect(Other.Body.Error.Code).toBe("IDEMPOTENCY_KEY_REUSED");
  expect(await Count("Orders")).toBe(1);
});

test("simultaneous retries of one payment create a single payment", async () => {
  const OrderId = await NewOrder(A.CompanyId, Customer, "114.00");
  const Results = await Promise.all(
    Array.from({ length: 6 }, () =>
      Call("POST", "/Payments", { Token: A.Token, Body: { OrderId, Amount: "50.00", Method: "Card" }, Headers: { "Idempotency-Key": "pay-1" } }),
    ),
  );
  expect(await Count("Payments")).toBe(1);
  for (const R of Results) expect([201, 409]).toContain(R.Status);
  const Ids = new Set(Results.filter((R) => R.Status === 201).map((R) => R.Body.Data.Id));
  expect(Ids.size).toBe(1);
  const Later = await Call("POST", "/Payments", { Token: A.Token, Body: { OrderId, Amount: "50.00", Method: "Card" }, Headers: { "Idempotency-Key": "pay-1" } });
  expect(Later.Status).toBe(201);
  expect(Ids.has(Later.Body.Data.Id)).toBe(true);
  expect(await Count("Payments")).toBe(1);
});

test("keys belong to each company separately", async () => {
  const B = await NewCompany();
  const BCustomer = await NewCustomer(B.CompanyId);
  const BProduct = await NewProduct(B.CompanyId, { Stock: 5 });
  const R1 = await PostOrder("shared-key", 1);
  const R2 = await PostOrder("shared-key", 1, B.Token, BCustomer, BProduct);
  expect(R1.Status).toBe(201);
  expect(R2.Status).toBe(201);
  expect(R2.Body.Data.Id).not.toBe(R1.Body.Data.Id);
  expect(await Count("Orders")).toBe(2);
});

test("requests without a key behave as before", async () => {
  expect((await PostOrder(null)).Status).toBe(201);
  expect((await PostOrder(null)).Status).toBe(201);
  expect(await Count("Orders")).toBe(2);
});

test("a key can be used again after 24 hours", async () => {
  const Start = Date.now();
  const First = await PostOrder("daily", 1);
  setSystemTime(new Date(Start + 23 * 3600_000));
  expect((await PostOrder("daily", 1)).Body.Data.Id).toBe(First.Body.Data.Id);
  setSystemTime(new Date(Start + 25 * 3600_000));
  const Later = await PostOrder("daily", 1);
  expect(Later.Status).toBe(201);
  expect(Later.Body.Data.Id).not.toBe(First.Body.Data.Id);
  expect(await Count("Orders")).toBe(2);
});

test("an over-long key is a validation error", async () => {
  const Res = await PostOrder("x".repeat(300));
  expect(Res.Status).toBe(400);
  expect(await Count("Orders")).toBe(0);
});
