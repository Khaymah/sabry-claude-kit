import { afterAll, beforeEach, expect, setSystemTime, test } from "bun:test";
import { At, Available, BuyOk, CheckIn, Created, Huge, Money, NewCompany, PromoOk, Refund, Reset, Setup, TicketStatus } from "../_Support";

beforeEach(async () => {
  await Reset();
  At("2026-12-01T10:00:00Z");
});

afterAll(() => setSystemTime());

test("r07: more than 48 hours before the session the whole paid price comes back and the seat is free again", async () => {
  const { A, Event, CustomerId, S1, C1 } = await Setup([{ Name: "Regular", Price: "33.33", Capacity: 3 }]);
  await PromoOk(A.Token, Event.Id, "P15", 15);
  const [T1, T2] = (await BuyOk(A.Token, S1, C1, CustomerId, 3, "P15")).Tickets;
  expect(await Available(A.Token, Event.Id, S1, C1)).toBe(0);
  At("2026-12-18T17:00:00Z");
  const Res = await Refund(A.Token, T1.Id);
  expect(Created(Res.Status)).toBe(true);
  expect(Res.Body.Data.TicketId).toBe(T1.Id);
  expect(Money(Res.Body.Data.Amount)).toBe(2834);
  expect(Res.Body.Data.Status).toBe("Refunded");
  expect(await TicketStatus(A.Token, T1.Id)).toBe("Refunded");
  expect(await Available(A.Token, Event.Id, S1, C1)).toBe(1);
  expect((await Refund(A.Token, T1.Id)).Status).toBe(409);
  At("2026-12-20T17:00:00Z");
  expect((await CheckIn(A.Token, S1, T1.Code)).Status).toBe(409);
  expect((await CheckIn(A.Token, S1, T2.Code)).Status).toBe(200);
});

test("r07: within 48 hours half comes back, floored per ticket; started sessions and used tickets are not refunded", async () => {
  const { A, Event, CustomerId, S1, C1 } = await Setup([{ Name: "Regular", Price: "33.33", Capacity: 5 }]);
  const [T1, T2, T3] = (await BuyOk(A.Token, S1, C1, CustomerId, 3)).Tickets;
  At("2026-12-18T20:00:00Z");
  const Half = await Refund(A.Token, T1.Id);
  expect(Created(Half.Status)).toBe(true);
  expect(Money(Half.Body.Data.Amount)).toBe(1666);
  At("2026-12-20T16:00:00Z");
  expect((await CheckIn(A.Token, S1, T2.Code)).Status).toBe(200);
  expect((await Refund(A.Token, T2.Id)).Status).toBe(409);
  expect(await TicketStatus(A.Token, T2.Id)).toBe("CheckedIn");
  At("2026-12-20T18:00:01Z");
  expect((await Refund(A.Token, T3.Id)).Status).toBe(409);
  expect(await TicketStatus(A.Token, T3.Id)).toBe("Valid");
  expect(await Available(A.Token, Event.Id, S1, C1)).toBe(3);
});

test("r07: a double click on refund refunds once; other companies cannot refund", async () => {
  const { A, Event, CustomerId, S1, C1 } = await Setup([{ Name: "Regular", Price: "100.00", Capacity: 5 }]);
  const [T] = (await BuyOk(A.Token, S1, C1, CustomerId, 2)).Tickets;
  const B = await NewCompany();
  expect((await Refund(B.Token, T.Id)).Status).toBe(404);
  expect(await TicketStatus(A.Token, T.Id)).toBe("Valid");
  expect([400, 404]).toContain((await Refund(A.Token, Huge)).Status);
  const Clicks = await Promise.all([Refund(A.Token, T.Id), Refund(A.Token, T.Id), Refund(A.Token, T.Id)]);
  expect(Clicks.filter((R) => Created(R.Status)).length).toBe(1);
  expect(Clicks.filter((R) => R.Status === 409).length).toBe(2);
  expect(await Available(A.Token, Event.Id, S1, C1)).toBe(4);
});
