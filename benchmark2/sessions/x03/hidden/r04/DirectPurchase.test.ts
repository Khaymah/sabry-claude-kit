import { afterAll, beforeEach, expect, setSystemTime, test } from "bun:test";
import { At, Available, Buy, BuyOk, Call, Created, HoldOk, Huge, Money, NewCompany, NewCustomer, PromoOk, PurchaseHold, Reset, Setup } from "../_Support";

beforeEach(async () => {
  await Reset();
  At("2026-12-01T10:00:00Z");
});

afterAll(() => setSystemTime());

test("r04: parallel buyers of the last seats: exactly the free seats are sold and active holds are respected", async () => {
  const { A, Event, CustomerId, S1, C1 } = await Setup([{ Name: "Regular", Price: "100.00", Capacity: 4 }]);
  const HoldId = await HoldOk(A.Token, S1, C1, CustomerId, 2);
  const Buyers = await Promise.all([1, 2, 3, 4, 5].map(() => Buy(A.Token, S1, C1, CustomerId, 1)));
  expect(Buyers.filter((R) => Created(R.Status)).length).toBe(2);
  expect(Buyers.filter((R) => R.Status === 409).length).toBe(3);
  expect(await Available(A.Token, Event.Id, S1, C1)).toBe(0);
  expect(Created((await PurchaseHold(A.Token, HoldId)).Status)).toBe(true);
  expect((await Buy(A.Token, S1, C1, CustomerId, 1)).Status).toBe(409);
  expect(await Available(A.Token, Event.Id, S1, C1)).toBe(0);
});

test("r04: seats of an expired hold can be bought, but only once under parallel buyers", async () => {
  const { A, Event, CustomerId, S1, C1 } = await Setup([{ Name: "Regular", Price: "100.00", Capacity: 3 }]);
  await HoldOk(A.Token, S1, C1, CustomerId, 3);
  expect((await Buy(A.Token, S1, C1, CustomerId, 1)).Status).toBe(409);
  At("2026-12-01T10:11:00Z");
  const Buyers = await Promise.all([1, 2, 3].map(() => Buy(A.Token, S1, C1, CustomerId, 2)));
  expect(Buyers.filter((R) => Created(R.Status)).length).toBe(1);
  expect(await Available(A.Token, Event.Id, S1, C1)).toBe(1);
  const Won = Buyers.find((R) => Created(R.Status))!.Body.Data;
  const Read = await Call("GET", `/Purchases/${Won.Id}`, { Token: A.Token });
  expect(Read.Status).toBe(200);
  expect(Read.Body.Data.Tickets.length).toBe(2);
  expect(Money(Read.Body.Data.Total)).toBe(20000);
});

test("r04: a direct purchase with a promo follows the per-ticket floor rule", async () => {
  const { A, Event, CustomerId, S1, C1 } = await Setup([{ Name: "Regular", Price: "66.65", Capacity: 10 }]);
  await PromoOk(A.Token, Event.Id, "P15", 15);
  const P = await BuyOk(A.Token, S1, C1, CustomerId, 4, "P15");
  expect(P.Tickets.length).toBe(4);
  for (const T of P.Tickets) expect(Money(T.Price)).toBe(5666);
  expect(Money(P.Total)).toBe(22664);
  expect(Money(P.Discount)).toBe(3996);
  expect([400, 404, 409, 422]).toContain((await Buy(A.Token, S1, C1, CustomerId, 1, "WRONG")).Status);
  expect(await Available(A.Token, Event.Id, S1, C1)).toBe(6);
});

test("r04: bad, foreign and late purchases are refused and record nothing", async () => {
  const { A, Event, CustomerId, S1, C1 } = await Setup([{ Name: "Regular", Price: "100.00", Capacity: 10 }]);
  for (const Q of [0, -1, 1.5, 11, 1e12]) expect((await Buy(A.Token, S1, C1, CustomerId, Q)).Status).toBe(400);
  expect([400, 404]).toContain((await Buy(A.Token, Huge, C1, CustomerId, 1)).Status);
  expect([400, 404]).toContain((await Buy(A.Token, S1, Huge, CustomerId, 1)).Status);
  expect([400, 404]).toContain((await Buy(A.Token, S1, C1, Huge, 1)).Status);
  const B = await NewCompany();
  const BCustomer = await NewCustomer(B.CompanyId);
  expect((await Buy(A.Token, S1, C1, BCustomer, 1)).Status).toBe(404);
  expect((await Buy(B.Token, S1, C1, BCustomer, 1)).Status).toBe(404);
  const P = await BuyOk(A.Token, S1, C1, CustomerId, 1);
  expect((await Call("GET", `/Purchases/${P.Id}`, { Token: B.Token })).Status).toBe(404);
  expect([400, 404]).toContain((await Call("GET", `/Purchases/${Huge}`, { Token: A.Token })).Status);
  expect(await Available(A.Token, Event.Id, S1, C1)).toBe(9);
  At("2026-12-20T18:30:00Z");
  expect((await Buy(A.Token, S1, C1, CustomerId, 1)).Status).toBe(409);
  expect(await Available(A.Token, Event.Id, S1, C1)).toBe(9);
});
