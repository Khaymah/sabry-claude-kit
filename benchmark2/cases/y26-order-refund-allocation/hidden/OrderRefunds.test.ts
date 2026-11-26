import { beforeEach, expect, test } from "bun:test";
import { Call, NewCompany, NewCustomer, NewOrder, Reset, Sql } from "./_Support";

let A: Awaited<ReturnType<typeof NewCompany>>;
let OrderId: number;
let P: number[];

beforeEach(async () => {
  await Reset();
  A = await NewCompany();
  const Customer = await NewCustomer(A.CompanyId);
  OrderId = await NewOrder(A.CompanyId, Customer, "114.00");
  P = [];
  for (const [Amount, Method] of [["50.00", "Cash"], ["30.00", "Card"], ["34.00", "Card"]]) {
    const Res = await Call("POST", "/Payments", { Token: A.Token, Body: { OrderId, Amount, Method } });
    expect(Res.Status).toBe(201);
    P.push(Res.Body.Data.Id);
  }
});

const Refund = (Amount: unknown, Id = OrderId, Token = A.Token) => Call("POST", `/Orders/${Id}/Refunds`, { Token, Body: { Amount } });

async function PerPayment() {
  const Rows = await Sql<{ PaymentId: number; S: string }>(`SELECT "PaymentId", sum("Amount")::text AS "S" FROM "Refunds" GROUP BY "PaymentId"`);
  return Object.fromEntries(Rows.map((R) => [R.PaymentId, R.S]));
}

async function Status() {
  const [Row] = await Sql<{ Status: string }>(`SELECT "Status" FROM "Orders" WHERE "Id" = $1`, [OrderId]);
  return Row.Status;
}

test("a refund is taken from the newest payment first", async () => {
  const Res = await Refund("40.00");
  expect(Res.Status).toBe(201);
  expect(Res.Body.Data.Allocations).toEqual([
    { PaymentId: P[2], Amount: "34.00" },
    { PaymentId: P[1], Amount: "6.00" },
  ]);
});

test("a second and third refund continue where the earlier ones stopped", async () => {
  expect((await Refund("40.00")).Status).toBe(201);
  const Second = await Refund("30.00");
  expect(Second.Status).toBe(201);
  expect(Second.Body.Data.Allocations).toEqual([
    { PaymentId: P[1], Amount: "24.00" },
    { PaymentId: P[0], Amount: "6.00" },
  ]);
  expect(await PerPayment()).toEqual({ [P[0]]: "6.00", [P[1]]: "30.00", [P[2]]: "34.00" });
  expect(await Status()).toBe("Paid");
  expect((await Refund("44.01")).Status).toBe(409);
  const Last = await Refund("44.00");
  expect(Last.Body.Data.Allocations).toEqual([{ PaymentId: P[0], Amount: "44.00" }]);
  expect(await Status()).toBe("Refunded");
  const Summary = await Call("GET", `/Orders/${OrderId}/Refunds`, { Token: A.Token });
  expect(Summary.Body.Data).toMatchObject({ RefundedAmount: "114.00", RefundableAmount: "0.00" });
});

test("piaster-sized refunds spill across payments exactly", async () => {
  expect((await Refund("33.99")).Status).toBe(201);
  const Res = await Refund("0.02");
  expect(Res.Body.Data.Allocations).toEqual([
    { PaymentId: P[2], Amount: "0.01" },
    { PaymentId: P[1], Amount: "0.01" },
  ]);
});

test("simultaneous refunds never exceed what was paid, per payment or in total", async () => {
  const Results = await Promise.all(Array.from({ length: 7 }, () => Refund("20.00")));
  expect(Results.filter((R) => R.Status === 201).length).toBe(5);
  const Per = await PerPayment();
  expect(Number(Per[P[0]] ?? 0)).toBeLessThanOrEqual(50);
  expect(Number(Per[P[1]] ?? 0)).toBeLessThanOrEqual(30);
  expect(Number(Per[P[2]] ?? 0)).toBeLessThanOrEqual(34);
  const [Total] = await Sql<{ S: string }>(`SELECT sum("Amount")::text AS "S" FROM "Refunds"`);
  expect(Total.S).toBe("100.00");
});

test("bad amounts and other companies are refused", async () => {
  for (const Bad of ["0", "-1.00", "1.005", "abc", null]) expect((await Refund(Bad)).Status).toBe(400);
  const B = await NewCompany();
  expect((await Refund("1.00", OrderId, B.Token)).Status).toBe(404);
  expect(await PerPayment()).toEqual({});
});
