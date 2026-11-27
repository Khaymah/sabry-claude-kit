import { afterAll, beforeEach, expect, setSystemTime, test } from "bun:test";
import { QueryStats } from "../../../Src/Database/Db";
import { At, BuyOk, Call, Huge, NewCompany, NewCustomer, NewEvent, NewOrganizer, Payout, PayoutOk, PromoOk, Refund, Reset } from "../_Support";

beforeEach(async () => {
  await Reset();
  At("2026-11-25T10:00:00Z");
});

afterAll(() => setSystemTime());

const Cats = [{ Name: "Regular", Price: "33.33", Capacity: 100 }];

async function World() {
  const A = await NewCompany();
  const O1 = await NewOrganizer(A.Token);
  const O2 = await NewOrganizer(A.Token);
  const E1 = await NewEvent(A.Token, O1, ["2026-12-20T18:00:00Z"], Cats);
  const E2 = await NewEvent(A.Token, O2, ["2026-12-20T18:00:00Z"], Cats);
  await PromoOk(A.Token, E1.Id, "P15", 15);
  const Customer = await NewCustomer(A.CompanyId);
  return { A, O1, O2, E1, E2, Customer };
}

test("r08: sales, refunds and fee by Cairo day, fee floored per ticket and kept after a refund", async () => {
  const { A, O1, E1, E2, Customer } = await World();
  const B = await NewCompany();
  const BOrg = await NewOrganizer(B.Token);
  const BEvent = await NewEvent(B.Token, BOrg, ["2026-12-20T18:00:00Z"], Cats);
  const BCustomer = await NewCustomer(B.CompanyId);
  At("2026-11-30T21:30:00Z");
  await BuyOk(A.Token, E1.Sessions[0], E1.Categories[0], Customer, 1);
  At("2026-11-30T22:30:00Z");
  const Promo = await BuyOk(A.Token, E1.Sessions[0], E1.Categories[0], Customer, 3, "P15");
  await BuyOk(A.Token, E2.Sessions[0], E2.Categories[0], Customer, 5);
  await BuyOk(B.Token, BEvent.Sessions[0], BEvent.Categories[0], BCustomer, 7);
  At("2026-12-03T10:00:00Z");
  await Refund(A.Token, Promo.Tickets[0].Id);
  expect(await PayoutOk(A.Token, O1, "2026-11-30", "2026-11-30")).toEqual({ Sales: 3333, Refunds: 0, Fee: 333, Net: 3000 });
  expect(await PayoutOk(A.Token, O1, "2026-12-01", "2026-12-01")).toEqual({ Sales: 8502, Refunds: 0, Fee: 849, Net: 7653 });
  expect(await PayoutOk(A.Token, O1, "2026-12-01", "2026-12-03")).toEqual({ Sales: 8502, Refunds: 2834, Fee: 849, Net: 4819 });
  expect(await PayoutOk(A.Token, O1, "2026-12-03", "2026-12-03")).toEqual({ Sales: 0, Refunds: 2834, Fee: 0, Net: -2834 });
  expect(await PayoutOk(A.Token, O1, "2026-11-01", "2026-11-29")).toEqual({ Sales: 0, Refunds: 0, Fee: 0, Net: 0 });
  const Full = await Payout(A.Token, O1, "2026-11-30", "2026-12-31");
  expect(Full.Body.Data.OrganizerId).toBe(O1);
  expect(String(Full.Body.Data.From).slice(0, 10)).toBe("2026-11-30");
  expect(String(Full.Body.Data.To).slice(0, 10)).toBe("2026-12-31");
});

test("r08: half refunds count what was actually given back", async () => {
  const { A, O1, E1, Customer } = await World();
  At("2026-12-10T10:00:00Z");
  const P = await BuyOk(A.Token, E1.Sessions[0], E1.Categories[0], Customer, 2);
  At("2026-12-19T10:00:00Z");
  await Refund(A.Token, P.Tickets[0].Id);
  expect(await PayoutOk(A.Token, O1, "2026-12-10", "2026-12-19")).toEqual({ Sales: 6666, Refunds: 1666, Fee: 666, Net: 4334 });
});

test("r08: a month of sales is reported within a small query budget", async () => {
  const { A, O1, Customer } = await World();
  const Events = [] as Awaited<ReturnType<typeof NewEvent>>[];
  for (let I = 0; I < 3; I++) Events.push(await NewEvent(A.Token, O1, ["2026-12-28T18:00:00Z"], [{ Name: "R", Price: `${10 + I}.15`, Capacity: 100 }]));
  let Sales = 0;
  let Fee = 0;
  for (let I = 0; I < 15; I++) {
    At(`2026-12-${String(I + 1).padStart(2, "0")}T12:00:00Z`);
    const E = Events[I % 3];
    await BuyOk(A.Token, E.Sessions[0], E.Categories[0], Customer, 10);
    const Price = 1015 + (I % 3) * 100;
    Sales += 10 * Price;
    Fee += 10 * Math.floor(Price / 10);
  }
  QueryStats.Reset();
  const Res = await Payout(A.Token, O1, "2026-12-01", "2026-12-31");
  const Queries = QueryStats.Count;
  expect(Res.Status).toBe(200);
  expect(Queries).toBeLessThanOrEqual(10);
  expect(await PayoutOk(A.Token, O1, "2026-12-01", "2026-12-31")).toEqual({ Sales, Refunds: 0, Fee, Net: Sales - Fee });
}, 120000);

test("r08: bad ranges are refused and another company's organizer is not found", async () => {
  const { A, O1 } = await World();
  for (const Q of ["From=2026-02-30&To=2026-03-01", "From=abc&To=2026-03-01", "From=2026-03-01", "To=2026-03-01", ""]) {
    expect((await Call("GET", `/Organizers/${O1}/Payout?${Q}`, { Token: A.Token })).Status).toBe(400);
  }
  expect([200, 400]).toContain((await Payout(A.Token, O1, "2026-03-05", "2026-03-01")).Status);
  const B = await NewCompany();
  expect((await Payout(B.Token, O1, "2026-12-01", "2026-12-31")).Status).toBe(404);
  expect([400, 404]).toContain((await Payout(A.Token, Huge, "2026-12-01", "2026-12-31")).Status);
});
