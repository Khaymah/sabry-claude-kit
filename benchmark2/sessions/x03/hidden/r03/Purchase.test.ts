import { afterAll, beforeEach, expect, setSystemTime, test } from "bun:test";
import { At, Available, Call, Created, GetTicket, HoldOk, Huge, Money, NewCompany, NewEvent, NewPromo, PromoOk, PurchaseHold, Reset, Setup } from "../_Support";

beforeEach(async () => {
  await Reset();
  At("2026-12-01T10:00:00Z");
});

afterAll(() => setSystemTime());

test("r03: a promo discount is worked out per ticket and floored to the piaster, even on a full category", async () => {
  const { A, Event, CustomerId, S1, C1 } = await Setup([{ Name: "Regular", Price: "33.33", Capacity: 3 }]);
  await PromoOk(A.Token, Event.Id, "XMAS15", 15);
  const HoldId = await HoldOk(A.Token, S1, C1, CustomerId, 3);
  const Res = await PurchaseHold(A.Token, HoldId, "XMAS15");
  expect(Created(Res.Status)).toBe(true);
  const P = Res.Body.Data;
  expect(P.CustomerId).toBe(CustomerId);
  expect(Money(P.Total)).toBe(8502);
  expect(Money(P.Discount)).toBe(1497);
  expect(P.Tickets.length).toBe(3);
  for (const T of P.Tickets) {
    expect(Money(T.Price)).toBe(2834);
    expect(T.Status).toBe("Valid");
    expect(T.SessionId).toBe(S1);
    expect(T.CategoryId).toBe(C1);
    expect(typeof T.Code).toBe("string");
    expect(T.Code.length).toBeGreaterThan(5);
  }
  expect(new Set(P.Tickets.map((T: any) => T.Code)).size).toBe(3);
  const One = await GetTicket(A.Token, P.Tickets[0].Id);
  expect(One.Status).toBe(200);
  expect(Money(One.Body.Data.Price)).toBe(2834);
  expect(One.Body.Data.Code).toBe(P.Tickets[0].Code);
  expect((await Call("GET", `/Holds/${HoldId}`, { Token: A.Token })).Body.Data.Status).toBe("Purchased");
  At("2026-12-01T11:00:00Z");
  expect(await Available(A.Token, Event.Id, S1, C1)).toBe(0);
});

test("r03: rounding stays per ticket for other prices and without a promo the full price is paid", async () => {
  const { A, Event, CustomerId, S1, C1 } = await Setup([{ Name: "Regular", Price: "19.99", Capacity: 10 }]);
  await PromoOk(A.Token, Event.Id, "HALF", 50);
  const P = (await PurchaseHold(A.Token, await HoldOk(A.Token, S1, C1, CustomerId, 3), "HALF")).Body.Data;
  expect(Money(P.Total)).toBe(3000);
  expect(Money(P.Discount)).toBe(2997);
  const Plain = await PurchaseHold(A.Token, await HoldOk(A.Token, S1, C1, CustomerId, 2));
  expect(Created(Plain.Status)).toBe(true);
  expect(Money(Plain.Body.Data.Total)).toBe(3998);
  expect(Money(Plain.Body.Data.Discount)).toBe(0);
});

test("r03: a hold is bought once; expired, released or bought holds cannot be bought", async () => {
  const { A, Event, CustomerId, S1, C1 } = await Setup([{ Name: "Regular", Price: "100.00", Capacity: 10 }]);
  const HoldId = await HoldOk(A.Token, S1, C1, CustomerId, 2);
  const Both = await Promise.all([PurchaseHold(A.Token, HoldId), PurchaseHold(A.Token, HoldId), PurchaseHold(A.Token, HoldId)]);
  expect(Both.filter((R) => Created(R.Status)).length).toBe(1);
  expect(Both.filter((R) => R.Status === 409).length).toBe(2);
  expect(await Available(A.Token, Event.Id, S1, C1)).toBe(8);
  const Released = await HoldOk(A.Token, S1, C1, CustomerId, 1);
  await Call("POST", `/Holds/${Released}/Release`, { Token: A.Token });
  expect((await PurchaseHold(A.Token, Released)).Status).toBe(409);
  const Late = await HoldOk(A.Token, S1, C1, CustomerId, 3);
  At("2026-12-01T10:10:01Z");
  expect((await PurchaseHold(A.Token, Late)).Status).toBe(409);
  expect(await Available(A.Token, Event.Id, S1, C1)).toBe(8);
});

test("r03: promo codes are per event and validated; another company cannot buy or read", async () => {
  const { A, OrganizerId, Event, CustomerId, S1, C1 } = await Setup([{ Name: "Regular", Price: "100.00", Capacity: 10 }]);
  const Other = await NewEvent(A.Token, OrganizerId, ["2026-12-22T18:00:00Z"], [{ Name: "Other", Price: "10.00", Capacity: 5 }]);
  await PromoOk(A.Token, Other.Id, "OTHER10", 10);
  for (const P of [0, 101, 12.5, -5]) expect((await NewPromo(A.Token, Event.Id, "BAD", P)).Status).toBe(400);
  await PromoOk(A.Token, Event.Id, "ONCE", 10);
  expect([400, 409]).toContain((await NewPromo(A.Token, Event.Id, "ONCE", 20)).Status);
  const HoldId = await HoldOk(A.Token, S1, C1, CustomerId, 1);
  expect([400, 404, 409, 422]).toContain((await PurchaseHold(A.Token, HoldId, "NOPE")).Status);
  expect([400, 404, 409, 422]).toContain((await PurchaseHold(A.Token, HoldId, "OTHER10")).Status);
  const B = await NewCompany();
  expect((await PurchaseHold(B.Token, HoldId)).Status).toBe(404);
  expect((await NewPromo(B.Token, Event.Id, "STEAL", 50)).Status).toBe(404);
  const Mine = await PurchaseHold(A.Token, HoldId, "ONCE");
  expect(Created(Mine.Status)).toBe(true);
  expect(Money(Mine.Body.Data.Total)).toBe(9000);
  expect((await GetTicket(B.Token, Mine.Body.Data.Tickets[0].Id)).Status).toBe(404);
  expect([400, 404]).toContain((await GetTicket(A.Token, Huge)).Status);
  expect([400, 404]).toContain((await PurchaseHold(A.Token, Huge)).Status);
});
