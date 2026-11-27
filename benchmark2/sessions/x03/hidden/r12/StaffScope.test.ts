import { afterAll, beforeEach, expect, setSystemTime, test } from "bun:test";
import {
  At, Available, Buy, BuyOk, Call, CancelEvent, CheckIn, CreateEvent, Created, GetTicket, Group, Hold, HoldOk, ListOf, NewCompany, NewCustomer,
  NewEvent, NewOrganizer, NewPromo, NewUser, Payout, PurchaseHold, Refund, Reset, TicketStatus, Transfer,
} from "../_Support";

beforeEach(async () => {
  await Reset();
  At("2026-12-01T10:00:00Z");
});

afterAll(() => setSystemTime());

const Cats = [{ Name: "Regular", Price: "100.00", Capacity: 20 }];
const Night = ["2026-12-20T18:00:00Z"];

async function World() {
  const A = await NewCompany();
  const Mine = await NewOrganizer(A.Token, "منظم مربوط");
  const Theirs = await NewOrganizer(A.Token, "منظم تاني");
  const EMine = await NewEvent(A.Token, Mine, Night, Cats);
  const ETheirs = await NewEvent(A.Token, Theirs, Night, Cats);
  const Customer = await NewCustomer(A.CompanyId);
  const Staff = await NewUser(A.CompanyId, "Staff");
  const Assign = await Call("POST", `/Organizers/${Mine}/Staff`, { Token: A.Token, Body: { UserId: Staff.UserId } });
  expect(Created(Assign.Status)).toBe(true);
  return { A, Mine, Theirs, EMine, ETheirs, Customer, Staff };
}

test("r12: staff work normally on their organizer's events", async () => {
  const { A, Mine, EMine, Customer, Staff } = await World();
  const S = Staff.Token;
  const Orgs = ListOf((await Call("GET", "/Organizers", { Token: S })).Body.Data);
  expect(Orgs.map((O: any) => O.Id)).toEqual([Mine]);
  expect((await Call("GET", `/Events/${EMine.Id}`, { Token: S })).Status).toBe(200);
  expect(Created((await CreateEvent(S, Mine, Night, Cats)).Status)).toBe(true);
  expect(Created((await NewPromo(S, EMine.Id, "STAFF10", 10)).Status)).toBe(true);
  const HoldId = await HoldOk(S, EMine.Sessions[0], EMine.Categories[0], Customer, 2);
  expect(Created((await PurchaseHold(S, HoldId, "STAFF10")).Status)).toBe(true);
  const P = await BuyOk(S, EMine.Sessions[0], EMine.Categories[0], Customer, 2);
  expect(Created((await Group(S, Customer, [{ SessionId: EMine.Sessions[0], CategoryId: EMine.Categories[0], Quantity: 2 }])).Status)).toBe(true);
  expect((await Call("GET", `/Purchases/${P.Id}`, { Token: S })).Status).toBe(200);
  expect(Created((await Refund(S, P.Tickets[0].Id)).Status)).toBe(true);
  expect(Created((await Transfer(S, P.Tickets[1].Id, "ضيف", "01033334444")).Status)).toBe(true);
  expect((await Payout(S, Mine, "2026-12-01", "2026-12-01")).Status).toBe(200);
  expect(await Available(S, EMine.Id, EMine.Sessions[0], EMine.Categories[0])).toBe(15);
  At("2026-12-20T17:00:00Z");
  const Code = (await GetTicket(S, P.Tickets[1].Id)).Body.Data.Code;
  expect((await CheckIn(S, EMine.Sessions[0], Code)).Status).toBe(200);
  expect(Created((await CancelEvent(A.Token, EMine.Id)).Status)).toBe(true);
});

test("r12: everything of another organizer is not found for staff, and nothing changes", async () => {
  const { A, Theirs, ETheirs, Customer, Staff } = await World();
  const S = Staff.Token;
  const Sess = ETheirs.Sessions[0];
  const Cat = ETheirs.Categories[0];
  const HoldId = await HoldOk(A.Token, Sess, Cat, Customer, 1);
  const P = await BuyOk(A.Token, Sess, Cat, Customer, 3);
  const [T1, T2, T3] = P.Tickets;
  expect((await Call("GET", `/Events/${ETheirs.Id}`, { Token: S })).Status).toBe(404);
  expect((await Call("GET", `/Events/${ETheirs.Id}/Availability`, { Token: S })).Status).toBe(404);
  expect([403, 404]).toContain((await CreateEvent(S, Theirs, Night, Cats)).Status);
  expect((await NewPromo(S, ETheirs.Id, "X", 50)).Status).toBe(404);
  expect((await Hold(S, Sess, Cat, Customer, 1)).Status).toBe(404);
  expect((await Call("GET", `/Holds/${HoldId}`, { Token: S })).Status).toBe(404);
  expect((await Call("POST", `/Holds/${HoldId}/Release`, { Token: S })).Status).toBe(404);
  expect((await PurchaseHold(S, HoldId)).Status).toBe(404);
  expect((await Buy(S, Sess, Cat, Customer, 1)).Status).toBe(404);
  expect((await Group(S, Customer, [{ SessionId: Sess, CategoryId: Cat, Quantity: 2 }])).Status).toBe(404);
  expect((await Call("GET", `/Purchases/${P.Id}`, { Token: S })).Status).toBe(404);
  expect((await GetTicket(S, T1.Id)).Status).toBe(404);
  expect((await Refund(S, T1.Id)).Status).toBe(404);
  expect((await Transfer(S, T2.Id, "حد", "01033334444")).Status).toBe(404);
  expect((await CancelEvent(S, ETheirs.Id)).Status).toBe(404);
  expect((await Payout(S, Theirs, "2026-12-01", "2026-12-01")).Status).toBe(404);
  At("2026-12-20T17:00:00Z");
  expect((await CheckIn(S, Sess, T3.Code)).Status).toBe(404);
  expect(await TicketStatus(A.Token, T1.Id)).toBe("Valid");
  expect(await TicketStatus(A.Token, T3.Id)).toBe("Valid");
  expect((await GetTicket(A.Token, T2.Id)).Body.Data.Code).toBe(T2.Code);
  expect((await Call("GET", `/Events/${ETheirs.Id}`, { Token: A.Token })).Body.Data.Status).toBe("OnSale");
  expect((await Call("GET", `/Holds/${HoldId}`, { Token: A.Token })).Body.Data.Status).not.toBe("Purchased");
});

test("r12: only owners and admins manage assignments; unassigned staff see nothing; admins see everything", async () => {
  const { A, Mine, Theirs, EMine, ETheirs, Staff } = await World();
  const Admin = await NewUser(A.CompanyId, "Admin");
  const Lonely = await NewUser(A.CompanyId, "Staff");
  expect((await Call("POST", "/Organizers", { Token: Staff.Token, Body: { Name: "منظم جديد" } })).Status).toBe(403);
  expect((await Call("POST", `/Organizers/${Mine}/Staff`, { Token: Staff.Token, Body: { UserId: Lonely.UserId } })).Status).toBe(403);
  const B = await NewCompany();
  const Outsider = await NewUser(B.CompanyId, "Staff");
  expect([400, 404]).toContain((await Call("POST", `/Organizers/${Mine}/Staff`, { Token: A.Token, Body: { UserId: Outsider.UserId } })).Status);
  expect((await Call("POST", `/Organizers/${Mine}/Staff`, { Token: B.Token, Body: { UserId: Outsider.UserId } })).Status).toBe(404);
  expect((await Call("GET", `/Events/${EMine.Id}`, { Token: Outsider.Token })).Status).toBe(404);
  expect([403, 404]).toContain((await Call("GET", `/Events/${EMine.Id}`, { Token: Lonely.Token })).Status);
  const LonelyOrgs = await Call("GET", "/Organizers", { Token: Lonely.Token });
  if (LonelyOrgs.Status === 200) expect(ListOf(LonelyOrgs.Body.Data).length).toBe(0);
  else expect(LonelyOrgs.Status).toBe(403);
  expect((await Call("GET", `/Events/${ETheirs.Id}`, { Token: Admin.Token })).Status).toBe(200);
  expect(ListOf((await Call("GET", "/Organizers", { Token: Admin.Token })).Body.Data).length).toBe(2);
  expect(Created((await Call("POST", `/Organizers/${Theirs}/Staff`, { Token: Admin.Token, Body: { UserId: Staff.UserId } })).Status)).toBe(true);
  expect((await Call("GET", `/Events/${ETheirs.Id}`, { Token: Staff.Token })).Status).toBe(200);
  const Removed = await Call("DELETE", `/Organizers/${Mine}/Staff/${Staff.UserId}`, { Token: A.Token });
  expect([200, 204]).toContain(Removed.Status);
  expect((await Call("GET", `/Events/${EMine.Id}`, { Token: Staff.Token })).Status).toBe(404);
  expect(ListOf((await Call("GET", "/Organizers", { Token: Staff.Token })).Body.Data).map((O: any) => O.Id)).toEqual([Theirs]);
});
