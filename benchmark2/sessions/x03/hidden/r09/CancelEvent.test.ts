import { afterAll, beforeEach, expect, setSystemTime, test } from "bun:test";
import { At, Buy, BuyOk, Call, CancelEvent, CheckIn, Created, Hold, HoldOk, Huge, Money, NewCompany, NewCustomer, NewEvent, NewOrganizer, PayoutOk, PromoOk, PurchaseHold, Refund, Reset, TicketStatus } from "../_Support";

beforeEach(async () => {
  await Reset();
  At("2026-11-25T10:00:00Z");
});

afterAll(() => setSystemTime());

const Cats = [{ Name: "Regular", Price: "33.33", Capacity: 50 }];

async function World() {
  const A = await NewCompany();
  const O1 = await NewOrganizer(A.Token);
  const E1 = await NewEvent(A.Token, O1, ["2026-12-20T18:00:00Z"], Cats);
  const E3 = await NewEvent(A.Token, O1, ["2026-12-27T18:00:00Z"], Cats);
  await PromoOk(A.Token, E1.Id, "P15", 15);
  const Customer = await NewCustomer(A.CompanyId);
  At("2026-12-01T10:00:00Z");
  const Sold = (await BuyOk(A.Token, E1.Sessions[0], E1.Categories[0], Customer, 4, "P15")).Tickets;
  await BuyOk(A.Token, E3.Sessions[0], E3.Categories[0], Customer, 2);
  return { A, O1, E1, E3, Customer, Sold };
}

test("r09: cancelling refunds every unrefunded ticket in full, once, and closes the event", async () => {
  const { A, E1, Customer, Sold } = await World();
  const [T1, T2, T3, T4] = Sold;
  At("2026-12-19T10:00:00Z");
  expect(Money((await Refund(A.Token, T1.Id)).Body.Data.Amount)).toBe(1417);
  At("2026-12-20T17:00:00Z");
  expect((await CheckIn(A.Token, E1.Sessions[0], T2.Code)).Status).toBe(200);
  const HoldId = await HoldOk(A.Token, E1.Sessions[0], E1.Categories[0], Customer, 2);
  At("2026-12-20T17:05:00Z");
  const Res = await CancelEvent(A.Token, E1.Id);
  expect(Created(Res.Status)).toBe(true);
  expect(Res.Body.Data.Status).toBe("Cancelled");
  expect(Number(Res.Body.Data.RefundedTickets)).toBe(3);
  expect(Money(Res.Body.Data.RefundedAmount)).toBe(8502);
  expect((await Call("GET", `/Events/${E1.Id}`, { Token: A.Token })).Body.Data.Status).toBe("Cancelled");
  for (const T of [T1, T2, T3, T4]) expect(await TicketStatus(A.Token, T.Id)).toBe("Refunded");
  expect((await Call("GET", `/Holds/${HoldId}`, { Token: A.Token })).Body.Data.Status).not.toBe("Active");
  expect((await PurchaseHold(A.Token, HoldId)).Status).toBe(409);
  expect((await Hold(A.Token, E1.Sessions[0], E1.Categories[0], Customer, 1)).Status).toBe(409);
  expect((await Buy(A.Token, E1.Sessions[0], E1.Categories[0], Customer, 1)).Status).toBe(409);
  expect((await CheckIn(A.Token, E1.Sessions[0], T3.Code)).Status).toBe(409);
  expect((await Refund(A.Token, T4.Id)).Status).toBe(409);
  expect((await CancelEvent(A.Token, E1.Id)).Status).toBe(409);
});

test("r09: the payout report drops the fee of a cancelled event on earlier days and counts the refunds on the cancel day", async () => {
  const { A, O1, E1 } = await World();
  expect(await PayoutOk(A.Token, O1, "2026-12-01", "2026-12-01")).toEqual({ Sales: 18002, Refunds: 0, Fee: 1798, Net: 16204 });
  At("2026-12-05T23:30:00Z");
  expect(Created((await CancelEvent(A.Token, E1.Id)).Status)).toBe(true);
  expect(await PayoutOk(A.Token, O1, "2026-12-01", "2026-12-01")).toEqual({ Sales: 18002, Refunds: 0, Fee: 666, Net: 17336 });
  expect(await PayoutOk(A.Token, O1, "2026-12-06", "2026-12-06")).toEqual({ Sales: 0, Refunds: 11336, Fee: 0, Net: -11336 });
  expect(await PayoutOk(A.Token, O1, "2026-12-05", "2026-12-05")).toEqual({ Sales: 0, Refunds: 0, Fee: 0, Net: 0 });
  expect(await PayoutOk(A.Token, O1, "2026-12-01", "2026-12-31")).toEqual({ Sales: 18002, Refunds: 11336, Fee: 666, Net: 6000 });
});

test("r09: a double click on cancel refunds once; other companies cannot cancel", async () => {
  const { A, O1, E1 } = await World();
  const B = await NewCompany();
  expect((await CancelEvent(B.Token, E1.Id)).Status).toBe(404);
  expect([400, 404]).toContain((await CancelEvent(A.Token, Huge)).Status);
  const BOrg = await NewOrganizer(B.Token);
  await NewEvent(B.Token, BOrg, ["2026-12-20T18:00:00Z"], Cats);
  expect((await Call("GET", `/Events/${E1.Id}`, { Token: A.Token })).Body.Data.Status).toBe("OnSale");
  At("2026-12-02T10:00:00Z");
  const Clicks = await Promise.all([CancelEvent(A.Token, E1.Id), CancelEvent(A.Token, E1.Id), CancelEvent(A.Token, E1.Id)]);
  expect(Clicks.filter((R) => Created(R.Status)).length).toBe(1);
  expect(Clicks.filter((R) => R.Status === 409).length).toBe(2);
  expect(await PayoutOk(A.Token, O1, "2026-12-02", "2026-12-02")).toEqual({ Sales: 0, Refunds: 11336, Fee: 0, Net: -11336 });
});
