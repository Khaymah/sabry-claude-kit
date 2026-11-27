import { afterAll, beforeEach, expect, setSystemTime, test } from "bun:test";
import { At, BuyOk, CheckIn, Created, Huge, NewCompany, NewCustomer, NewEvent, NewOrganizer, Reset, Setup, TicketStatus } from "../_Support";

beforeEach(async () => {
  await Reset();
  At("2026-12-01T10:00:00Z");
});

afterAll(() => setSystemTime());

const Nights = ["2026-12-20T18:00:00Z", "2026-12-21T18:00:00Z"];
const Cats = [{ Name: "Regular", Price: "100.00", Capacity: 20 }];

test("r06: a ticket gets in once, only at its own session", async () => {
  const { A, Event, CustomerId } = await Setup(Cats, Nights);
  const [N1, N2] = Event.Sessions;
  const [T1, T2] = (await BuyOk(A.Token, N1, Event.Categories[0], CustomerId, 2)).Tickets;
  const [F1] = (await BuyOk(A.Token, N2, Event.Categories[0], CustomerId, 1)).Tickets;
  At("2026-12-20T17:00:00Z");
  const Res = await CheckIn(A.Token, N1, T1.Code);
  expect(Res.Status).toBe(200);
  expect(Res.Body.Data).toMatchObject({ TicketId: T1.Id, Status: "CheckedIn" });
  expect(await TicketStatus(A.Token, T1.Id)).toBe("CheckedIn");
  expect((await CheckIn(A.Token, N1, T1.Code)).Status).toBe(409);
  expect((await CheckIn(A.Token, N1, F1.Code)).Status).toBe(409);
  expect(await TicketStatus(A.Token, F1.Id)).toBe("Valid");
  expect((await CheckIn(A.Token, N1, "NO-SUCH-CODE")).Status).toBe(404);
  expect(await TicketStatus(A.Token, T2.Id)).toBe("Valid");
  At("2026-12-21T16:00:00Z");
  expect((await CheckIn(A.Token, N2, F1.Code)).Status).toBe(200);
});

test("r06: the same ticket scanned at two gates at the same moment lets one person in", async () => {
  const { A, Event, CustomerId, S1, C1 } = await Setup(Cats);
  const [T] = (await BuyOk(A.Token, S1, C1, CustomerId, 1)).Tickets;
  At("2026-12-20T17:30:00Z");
  const Scans = await Promise.all([1, 2, 3, 4].map(() => CheckIn(A.Token, S1, T.Code)));
  expect(Scans.filter((R) => R.Status === 200).length).toBe(1);
  expect(Scans.filter((R) => R.Status === 409).length).toBe(3);
  expect(await TicketStatus(A.Token, T.Id)).toBe("CheckedIn");
});

test("r06: the gate opens three hours before the session", async () => {
  const { A, CustomerId, S1, C1 } = await Setup(Cats);
  const [T] = (await BuyOk(A.Token, S1, C1, CustomerId, 1)).Tickets;
  At("2026-12-20T14:55:00Z");
  expect((await CheckIn(A.Token, S1, T.Code)).Status).toBe(409);
  expect(await TicketStatus(A.Token, T.Id)).toBe("Valid");
  At("2026-12-20T15:05:00Z");
  expect((await CheckIn(A.Token, S1, T.Code)).Status).toBe(200);
});

test("r06: another company's gate cannot scan our tickets", async () => {
  const { A, CustomerId, S1, C1 } = await Setup(Cats);
  const [T] = (await BuyOk(A.Token, S1, C1, CustomerId, 1)).Tickets;
  const B = await NewCompany();
  const BOrg = await NewOrganizer(B.Token);
  const BEvent = await NewEvent(B.Token, BOrg, ["2026-12-20T18:00:00Z"], Cats);
  await NewCustomer(B.CompanyId);
  At("2026-12-20T17:00:00Z");
  expect((await CheckIn(B.Token, BEvent.Sessions[0], T.Code)).Status).toBe(404);
  expect((await CheckIn(B.Token, S1, T.Code)).Status).toBe(404);
  expect([400, 404]).toContain((await CheckIn(A.Token, Huge, T.Code)).Status);
  expect(await TicketStatus(A.Token, T.Id)).toBe("Valid");
  expect(Created((await CheckIn(A.Token, S1, T.Code)).Status)).toBe(true);
});
