import { beforeEach, expect, test } from "bun:test";
import { Call, NewCompany, NewCustomer, NewOrder, Reset, Sql } from "./_Support";

let A: Awaited<ReturnType<typeof NewCompany>>;
let Customer: number;

beforeEach(async () => {
  await Reset();
  A = await NewCompany();
  Customer = await NewCustomer(A.CompanyId, { WalletBalance: "0.00" });
});

const Pay = (OrderId: number, Amount: string, Method = "Cash") => Call("POST", "/Payments", { Token: A.Token, Body: { OrderId, Amount, Method } });
const Loyalty = async (Id = Customer, Token = A.Token) => Call("GET", `/Customers/${Id}/Loyalty`, { Token });
const Redeem = (Points: unknown, Id = Customer, Token = A.Token) => Call("POST", `/Customers/${Id}/Loyalty/Redeem`, { Token, Body: { Points } });
const SetPoints = (Points: number, Wallet = "0.00") => Sql(`UPDATE "Customers" SET "LoyaltyPoints" = $1, "WalletBalance" = $2 WHERE "Id" = $3`, [Points, Wallet, Customer]);

async function Wallet() {
  const [Row] = await Sql<{ W: string }>(`SELECT "WalletBalance"::text AS "W" FROM "Customers" WHERE "Id" = $1`, [Customer]);
  return Row.W;
}

test("points are earned once, when the order is fully paid", async () => {
  const OrderId = await NewOrder(A.CompanyId, Customer, "228.00");
  expect((await Pay(OrderId, "100.00")).Status).toBe(201);
  expect((await Loyalty()).Body.Data.Points).toBe(0);
  expect((await Pay(OrderId, "128.00")).Status).toBe(201);
  expect((await Loyalty()).Body.Data.Points).toBe(22);
  expect((await Pay(OrderId, "1.00")).Status).toBe(409);
  expect((await Loyalty()).Body.Data.Points).toBe(22);
});

test("only whole tens of pounds earn points", async () => {
  const Small = await NewOrder(A.CompanyId, Customer, "9.99");
  const Ten = await NewOrder(A.CompanyId, Customer, "10.00");
  await Pay(Small, "9.99");
  expect((await Loyalty()).Body.Data.Points).toBe(0);
  await Pay(Ten, "10.00");
  expect((await Loyalty()).Body.Data.Points).toBe(1);
});

test("concurrent payments that finish an order award points once", async () => {
  const OrderId = await NewOrder(A.CompanyId, Customer, "114.00");
  const Results = await Promise.all([Pay(OrderId, "114.00"), Pay(OrderId, "114.00"), Pay(OrderId, "114.00")]);
  expect(Results.filter((R) => R.Status === 201).length).toBe(1);
  expect((await Loyalty()).Body.Data.Points).toBe(11);
});

test("redeeming turns each 100 points into 10 pounds of wallet credit", async () => {
  await SetPoints(250);
  const Res = await Redeem(200);
  expect(Res.Status).toBe(200);
  const L = await Loyalty();
  expect(L.Body.Data.Points).toBe(50);
  expect(L.Body.Data.WalletBalance).toBe("20.00");
  expect((await Redeem(150)).Status).toBe(400);
  expect((await Redeem(100)).Status).toBe(409);
  for (const Bad of [0, -100, 100.5, "100"]) expect((await Redeem(Bad)).Status).toBe(400);
  expect((await Loyalty()).Body.Data.Points).toBe(50);
});

test("simultaneous redemptions never overdraw points", async () => {
  await SetPoints(300);
  const Results = await Promise.all(Array.from({ length: 6 }, () => Redeem(100)));
  expect(Results.filter((R) => R.Status === 200).length).toBe(3);
  const L = await Loyalty();
  expect(L.Body.Data.Points).toBe(0);
  expect(L.Body.Data.WalletBalance).toBe("30.00");
});

test("paying with the wallet spends the balance and refuses when it is short", async () => {
  await SetPoints(0, "100.00");
  const First = await NewOrder(A.CompanyId, Customer, "60.00");
  const Res = await Pay(First, "60.00", "Wallet");
  expect(Res.Status).toBe(201);
  expect(await Wallet()).toBe("40.00");
  expect((await Loyalty()).Body.Data.Points).toBe(6);
  const Second = await NewOrder(A.CompanyId, Customer, "50.00");
  const Short = await Pay(Second, "50.00", "Wallet");
  expect(Short.Status).toBe(409);
  expect(Short.Body.Error.Code).toBe("INSUFFICIENT_BALANCE");
  expect(await Wallet()).toBe("40.00");
  const [Count] = await Sql<{ N: number }>(`SELECT count(*)::int AS "N" FROM "Payments" WHERE "OrderId" = $1`, [Second]);
  expect(Count.N).toBe(0);
});

test("simultaneous wallet payments never overdraw the wallet", async () => {
  await SetPoints(0, "100.00");
  const Orders = [await NewOrder(A.CompanyId, Customer, "40.00"), await NewOrder(A.CompanyId, Customer, "40.00"), await NewOrder(A.CompanyId, Customer, "40.00")];
  const Results = await Promise.all(Orders.map((Id) => Pay(Id, "40.00", "Wallet")));
  expect(Results.filter((R) => R.Status === 201).length).toBe(2);
  expect(await Wallet()).toBe("20.00");
});

test("another company cannot see or redeem a customer's points", async () => {
  await SetPoints(500);
  const B = await NewCompany();
  expect((await Loyalty(Customer, B.Token)).Status).toBe(404);
  expect((await Redeem(100, Customer, B.Token)).Status).toBe(404);
  expect((await Loyalty()).Body.Data.Points).toBe(500);
});
