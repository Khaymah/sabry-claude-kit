import { afterEach, beforeEach, expect, setSystemTime, test } from "bun:test";
import { Call, NewCompany, NewCustomer, NewProduct, NewUser, Reset, Sql } from "./_Support";

let A: Awaited<ReturnType<typeof NewCompany>>;
let Customer: number;

beforeEach(async () => {
  await Reset();
  A = await NewCompany();
  Customer = await NewCustomer(A.CompanyId);
});

afterEach(() => {
  setSystemTime();
});

async function MakeOrder(Token: string, CustomerId: number, CompanyId: number, Price = "100.00", Quantity = 2) {
  const ProductId = await NewProduct(CompanyId, { Price, Stock: 1000 });
  const Res = await Call("POST", "/Orders", { Token, Body: { CustomerId, Items: [{ ProductId, Quantity }] } });
  expect(Res.Status).toBe(201);
  return Res.Body.Data.Id as number;
}

async function Coupon(Body: Record<string, unknown>, Token = A.Token) {
  return Call("POST", "/Coupons", { Token, Body });
}

function Apply(OrderId: number, Code: string, Token = A.Token) {
  return Call("POST", `/Orders/${OrderId}/ApplyCoupon`, { Token, Body: { Code } });
}

async function OrderRow(Id: number) {
  const [Row] = await Sql(`SELECT "Subtotal"::text AS "Subtotal", "Discount"::text AS "Discount", "Tax"::text AS "Tax", "Total"::text AS "Total" FROM "Orders" WHERE "Id" = $1`, [Id]);
  return Row;
}

test("applying a coupon recalculates discount, tax and total", async () => {
  expect((await Coupon({ Code: "SAVE15", DiscountPercent: 15, MaxUses: 10 })).Status).toBe(201);
  const OrderId = await MakeOrder(A.Token, Customer, A.CompanyId);
  const Res = await Apply(OrderId, "SAVE15");
  expect(Res.Status).toBe(200);
  expect(await OrderRow(OrderId)).toEqual({ Subtotal: "200.00", Discount: "30.00", Tax: "23.80", Total: "193.80" });
  expect(Res.Body.Data.Total).toBe("193.80");
});

test("coupon discount and tax round half-up to the piaster", async () => {
  await Coupon({ Code: "TEN", DiscountPercent: 10, MaxUses: 10 });
  const OrderId = await MakeOrder(A.Token, Customer, A.CompanyId, "10.05", 1);
  expect((await Apply(OrderId, "TEN")).Status).toBe(200);
  expect(await OrderRow(OrderId)).toEqual({ Subtotal: "10.05", Discount: "1.01", Tax: "1.27", Total: "10.31" });
});

test("concurrent redemptions never exceed the usage limit", async () => {
  await Coupon({ Code: "FLASH", DiscountPercent: 20, MaxUses: 3 });
  const Orders = [];
  for (let I = 0; I < 10; I++) Orders.push(await MakeOrder(A.Token, Customer, A.CompanyId));
  const Results = await Promise.all(Orders.map((Id) => Apply(Id, "FLASH")));
  expect(Results.filter((R) => R.Status === 200).length).toBe(3);
  expect(Results.filter((R) => R.Status === 409).length).toBe(7);
  const [Count] = await Sql<{ N: number }>(`SELECT count(*)::int AS "N" FROM "Orders" WHERE "Discount" > 0`);
  expect(Count.N).toBe(3);
});

test("double-clicking apply on one order discounts it once and uses one redemption", async () => {
  await Coupon({ Code: "ONCE", DiscountPercent: 50, MaxUses: 2 });
  const First = await MakeOrder(A.Token, Customer, A.CompanyId);
  const Results = await Promise.all(Array.from({ length: 5 }, () => Apply(First, "ONCE")));
  expect(Results.filter((R) => R.Status === 200).length).toBe(1);
  expect(await OrderRow(First)).toEqual({ Subtotal: "200.00", Discount: "100.00", Tax: "14.00", Total: "114.00" });
  const Second = await MakeOrder(A.Token, Customer, A.CompanyId);
  expect((await Apply(Second, "ONCE")).Status).toBe(200);
  const Third = await MakeOrder(A.Token, Customer, A.CompanyId);
  expect((await Apply(Third, "ONCE")).Status).toBe(409);
  expect(await OrderRow(Third)).toEqual({ Subtotal: "200.00", Discount: "0.00", Tax: "28.00", Total: "228.00" });
});

test("codes are case-insensitive and private to each company", async () => {
  await Coupon({ Code: "Summer10", DiscountPercent: 10, MaxUses: 5 });
  const OrderId = await MakeOrder(A.Token, Customer, A.CompanyId);
  expect((await Apply(OrderId, "summer10")).Status).toBe(200);
  const B = await NewCompany();
  const BCustomer = await NewCustomer(B.CompanyId);
  const BOrder = await MakeOrder(B.Token, BCustomer, B.CompanyId);
  expect((await Apply(BOrder, "SUMMER10", B.Token)).Status).toBe(404);
  expect((await Apply(OrderId, "SUMMER10", B.Token)).Status).toBe(404);
  expect((await Coupon({ Code: "SUMMER10", DiscountPercent: 5, MaxUses: 1 }, B.Token)).Status).toBe(201);
  expect((await Coupon({ Code: "summer10", DiscountPercent: 5, MaxUses: 1 })).Status).toBe(409);
});

test("an expired coupon is refused", async () => {
  const Start = new Date();
  await Coupon({ Code: "SOON", DiscountPercent: 10, MaxUses: 5, ExpiresAt: new Date(Start.getTime() + 3600_000).toISOString() });
  const OrderId = await MakeOrder(A.Token, Customer, A.CompanyId);
  setSystemTime(new Date(Start.getTime() + 2 * 3600_000));
  const Res = await Apply(OrderId, "SOON");
  expect(Res.Status).toBe(409);
  expect((await OrderRow(OrderId)).Discount).toBe("0.00");
});

test("only owners and admins create coupons, with sane values", async () => {
  const Staff = await NewUser(A.CompanyId, "Staff");
  expect((await Coupon({ Code: "STAFF", DiscountPercent: 10, MaxUses: 5 }, Staff.Token)).Status).toBe(403);
  for (const Bad of [
    { Code: "BAD1", DiscountPercent: 0, MaxUses: 5 },
    { Code: "BAD2", DiscountPercent: 101, MaxUses: 5 },
    { Code: "BAD3", DiscountPercent: 12.5, MaxUses: 5 },
    { Code: "BAD4", DiscountPercent: 10, MaxUses: 0 },
  ]) {
    expect((await Coupon(Bad)).Status).toBe(400);
  }
});
