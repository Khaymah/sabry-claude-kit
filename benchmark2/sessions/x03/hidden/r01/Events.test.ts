import { afterAll, beforeEach, expect, setSystemTime, test } from "bun:test";
import { At, Call, CreateEvent, Created, Huge, ListOf, Money, NewCompany, NewOrganizer, Reset } from "../_Support";

beforeEach(async () => {
  await Reset();
  At("2026-12-01T10:00:00Z");
});

afterAll(() => setSystemTime());

const Cats = [
  { Name: "VIP", Price: "350.50", Capacity: 40 },
  { Name: "Regular", Price: "120.00", Capacity: 200 },
];

test("r01: an event with sessions and categories is created, read back and shows full availability", async () => {
  const A = await NewCompany();
  const Res = await Call("POST", "/Organizers", { Token: A.Token, Body: { Name: "منظم الساقية" } });
  expect(Created(Res.Status)).toBe(true);
  expect(Res.Body.Data.Name).toBe("منظم الساقية");
  const OrganizerId = Res.Body.Data.Id;
  expect(ListOf((await Call("GET", "/Organizers", { Token: A.Token })).Body.Data).some((O: any) => O.Id === OrganizerId)).toBe(true);
  const Made = await CreateEvent(A.Token, OrganizerId, ["2026-12-24T18:00:00Z", "2026-12-25T18:00:00Z"], Cats, "حفلة رأس السنة");
  expect(Created(Made.Status)).toBe(true);
  const Id = Made.Body.Data.Id;
  const Got = await Call("GET", `/Events/${Id}`, { Token: A.Token });
  expect(Got.Status).toBe(200);
  const E = Got.Body.Data;
  expect(E).toMatchObject({ Id, OrganizerId, Name: "حفلة رأس السنة", Status: "OnSale" });
  expect(E.Sessions.length).toBe(2);
  expect(E.Categories.length).toBe(2);
  const Vip = E.Categories.find((C: any) => C.Name === "VIP");
  expect(Money(Vip.Price)).toBe(35050);
  expect(Number(Vip.Capacity)).toBe(40);
  const Av = await Call("GET", `/Events/${Id}/Availability`, { Token: A.Token });
  expect(Av.Status).toBe(200);
  const Items = ListOf(Av.Body.Data);
  expect(Items.length).toBe(4);
  for (const S of E.Sessions) {
    const Row = Items.find((I: any) => Number(I.SessionId) === S.Id && Number(I.CategoryId) === Vip.Id);
    expect(Number(Row.Available)).toBe(40);
    expect(Number(Row.Capacity)).toBe(40);
  }
});

test("r01: another company cannot see or use the organizer and the event", async () => {
  const A = await NewCompany();
  const B = await NewCompany();
  const OrganizerId = await NewOrganizer(A.Token, "منظم شركة أ");
  const Made = await CreateEvent(A.Token, OrganizerId, ["2026-12-24T18:00:00Z"], Cats);
  const Id = Made.Body.Data.Id;
  expect((await Call("GET", `/Events/${Id}`, { Token: B.Token })).Status).toBe(404);
  expect((await Call("GET", `/Events/${Id}/Availability`, { Token: B.Token })).Status).toBe(404);
  expect((await CreateEvent(B.Token, OrganizerId, ["2026-12-24T18:00:00Z"], Cats)).Status).toBe(404);
  const List = await Call("GET", "/Organizers", { Token: B.Token });
  expect(List.Status).toBe(200);
  expect(List.Text).not.toContain("منظم شركة أ");
  expect((await Call("GET", "/Organizers")).Status).toBe(401);
});

test("r01: bad event input is refused, never a server error", async () => {
  const A = await NewCompany();
  const OrganizerId = await NewOrganizer(A.Token);
  const S = ["2026-12-24T18:00:00Z"];
  const Bad: [string[], any[]][] = [
    [[], Cats],
    [S, []],
    [["not a date"], Cats],
    [S, [{ Name: "VIP", Price: "-5.00", Capacity: 10 }]],
    [S, [{ Name: "VIP", Price: "abc", Capacity: 10 }]],
    [S, [{ Name: "VIP", Price: "10.555", Capacity: 10 }]],
    [S, [{ Name: "VIP", Price: "10.00", Capacity: 0 }]],
    [S, [{ Name: "VIP", Price: "10.00", Capacity: -3 }]],
    [S, [{ Name: "VIP", Price: "10.00", Capacity: 2.5 }]],
    [S, [{ Name: "", Price: "10.00", Capacity: 5 }]],
  ];
  for (const [Sessions, Categories] of Bad) expect((await CreateEvent(A.Token, OrganizerId, Sessions, Categories)).Status).toBe(400);
  expect((await Call("POST", "/Events", { Token: A.Token, Body: { OrganizerId, Categories: Cats } })).Status).toBe(400);
  expect([200, 201, 400]).toContain((await CreateEvent(A.Token, OrganizerId, S, [{ Name: "VIP", Price: "99999999999.00", Capacity: 10 }])).Status);
  expect([200, 201, 400]).toContain((await CreateEvent(A.Token, OrganizerId, S, [{ Name: "VIP", Price: "10.00", Capacity: 1e12 }])).Status);
  expect((await CreateEvent(A.Token, OrganizerId, S, Cats, "")).Status).toBe(400);
  expect([400, 404]).toContain((await CreateEvent(A.Token, Huge, S, Cats)).Status);
  expect([400, 404]).toContain((await CreateEvent(A.Token, 999999, S, Cats)).Status);
  for (const Body of [{}, { Name: "" }, { Name: 7 }]) expect((await Call("POST", "/Organizers", { Token: A.Token, Body })).Status).toBe(400);
  expect([400, 404]).toContain((await Call("GET", `/Events/${Huge}`, { Token: A.Token })).Status);
  expect([400, 404]).toContain((await Call("GET", "/Events/abc", { Token: A.Token })).Status);
  expect([400, 404]).toContain((await Call("GET", `/Events/${Huge}/Availability`, { Token: A.Token })).Status);
});
