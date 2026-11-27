import { afterAll, beforeEach, expect, setSystemTime, test } from "bun:test";
import { At, Available, Call, Created, Hold, HoldOk, Huge, NewCompany, NewCustomer, NewEvent, NewOrganizer, Reset, Setup } from "../_Support";

beforeEach(async () => {
  await Reset();
  At("2026-12-01T10:00:00Z");
});

afterAll(() => setSystemTime());

test("r02: a hold takes seats for ten minutes, then they come back on their own; release gives them back once", async () => {
  const { A, Event, CustomerId, S1, C1 } = await Setup([{ Name: "Regular", Price: "100.00", Capacity: 10 }]);
  const Res = await Hold(A.Token, S1, C1, CustomerId, 4);
  expect(Created(Res.Status)).toBe(true);
  expect(Res.Body.Data).toMatchObject({ SessionId: S1, CategoryId: C1, CustomerId, Quantity: 4, Status: "Active" });
  const Id = Res.Body.Data.Id;
  expect(await Available(A.Token, Event.Id, S1, C1)).toBe(6);
  At("2026-12-01T10:09:30Z");
  expect(await Available(A.Token, Event.Id, S1, C1)).toBe(6);
  expect((await Call("GET", `/Holds/${Id}`, { Token: A.Token })).Body.Data.Status).toBe("Active");
  At("2026-12-01T10:10:30Z");
  expect(await Available(A.Token, Event.Id, S1, C1)).toBe(10);
  const Read = await Call("GET", `/Holds/${Id}`, { Token: A.Token });
  expect(Read.Status).toBe(200);
  expect(Read.Body.Data.Status).toBe("Expired");
  const Second = await HoldOk(A.Token, S1, C1, CustomerId, 3);
  expect(await Available(A.Token, Event.Id, S1, C1)).toBe(7);
  const Released = await Promise.all([
    Call("POST", `/Holds/${Second}/Release`, { Token: A.Token }),
    Call("POST", `/Holds/${Second}/Release`, { Token: A.Token }),
  ]);
  expect(Released.some((R) => Created(R.Status))).toBe(true);
  expect(Released.every((R) => Created(R.Status) || R.Status === 409)).toBe(true);
  expect(await Available(A.Token, Event.Id, S1, C1)).toBe(10);
});

test("r02: parallel holds on the last seats never oversell", async () => {
  const { A, Event, CustomerId, S1, C1 } = await Setup([{ Name: "Regular", Price: "100.00", Capacity: 5 }]);
  const All = await Promise.all([1, 2, 3, 4].map(() => Hold(A.Token, S1, C1, CustomerId, 2)));
  expect(All.filter((R) => Created(R.Status)).length).toBe(2);
  expect(All.filter((R) => R.Status === 409).length).toBe(2);
  expect(await Available(A.Token, Event.Id, S1, C1)).toBe(1);
  expect((await Hold(A.Token, S1, C1, CustomerId, 2)).Status).toBe(409);
  expect(await Available(A.Token, Event.Id, S1, C1)).toBe(1);
});

test("r02: bad, foreign and late holds are refused and take nothing", async () => {
  const { A, OrganizerId, Event, CustomerId, S1, C1 } = await Setup([{ Name: "Regular", Price: "100.00", Capacity: 20 }]);
  const Other = await NewEvent(A.Token, OrganizerId, ["2026-12-21T18:00:00Z"], [{ Name: "Other", Price: "50.00", Capacity: 20 }]);
  for (const Q of [0, -1, 1.5, 11, 1e12]) expect((await Hold(A.Token, S1, C1, CustomerId, Q)).Status).toBe(400);
  expect([400, 404]).toContain((await Hold(A.Token, S1, Other.Categories[0], CustomerId, 1)).Status);
  expect([400, 404]).toContain((await Hold(A.Token, Huge, C1, CustomerId, 1)).Status);
  expect([400, 404]).toContain((await Hold(A.Token, S1, C1, Huge, 1)).Status);
  const B = await NewCompany();
  const BCustomer = await NewCustomer(B.CompanyId);
  const BOrg = await NewOrganizer(B.Token);
  const BEvent = await NewEvent(B.Token, BOrg, ["2026-12-20T18:00:00Z"], [{ Name: "B", Price: "10.00", Capacity: 5 }]);
  expect((await Hold(A.Token, S1, C1, BCustomer, 1)).Status).toBe(404);
  expect((await Hold(B.Token, S1, C1, BCustomer, 1)).Status).toBe(404);
  expect((await Hold(A.Token, BEvent.Sessions[0], BEvent.Categories[0], CustomerId, 1)).Status).toBe(404);
  const Id = await HoldOk(A.Token, S1, C1, CustomerId, 2);
  expect((await Call("GET", `/Holds/${Id}`, { Token: B.Token })).Status).toBe(404);
  expect((await Call("POST", `/Holds/${Id}/Release`, { Token: B.Token })).Status).toBe(404);
  expect([400, 404]).toContain((await Call("GET", `/Holds/${Huge}`, { Token: A.Token })).Status);
  expect(await Available(A.Token, Event.Id, S1, C1)).toBe(18);
  At("2026-12-20T18:00:01Z");
  expect((await Hold(A.Token, S1, C1, CustomerId, 1)).Status).toBe(409);
});
