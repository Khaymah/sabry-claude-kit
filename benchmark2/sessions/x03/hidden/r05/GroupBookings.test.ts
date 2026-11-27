import { afterAll, beforeEach, expect, setSystemTime, test } from "bun:test";
import { At, Available, Created, Group, Huge, Money, NewCompany, NewCustomer, NewEvent, PromoOk, Reset, Setup } from "../_Support";

beforeEach(async () => {
  await Reset();
  At("2026-12-01T10:00:00Z");
});

afterAll(() => setSystemTime());

const Cats = [
  { Name: "VIP", Price: "33.33", Capacity: 15 },
  { Name: "Regular", Price: "33.33", Capacity: 30 },
];
const Nights = ["2026-12-20T18:00:00Z", "2026-12-21T18:00:00Z"];

test("r05: a group booking is all or nothing", async () => {
  const { A, OrganizerId, Event, CustomerId } = await Setup(Cats, Nights);
  const [N1, N2] = Event.Sessions;
  const [Vip, Reg] = Event.Categories;
  const Other = await NewEvent(A.Token, OrganizerId, ["2026-12-22T18:00:00Z"], [{ Name: "X", Price: "10.00", Capacity: 50 }]);
  expect((await Group(A.Token, CustomerId, [{ SessionId: N1, CategoryId: Reg, Quantity: 10 }, { SessionId: N2, CategoryId: Vip, Quantity: 16 }])).Status).toBe(409);
  expect([400, 409]).toContain(
    (await Group(A.Token, CustomerId, [{ SessionId: N1, CategoryId: Vip, Quantity: 10 }, { SessionId: N1, CategoryId: Vip, Quantity: 10 }])).Status,
  );
  expect([400, 404]).toContain(
    (await Group(A.Token, CustomerId, [{ SessionId: N1, CategoryId: Reg, Quantity: 2 }, { SessionId: N1, CategoryId: Other.Categories[0], Quantity: 2 }])).Status,
  );
  expect([400, 404, 409]).toContain(
    (await Group(A.Token, CustomerId, [{ SessionId: N1, CategoryId: Reg, Quantity: 2 }, { SessionId: Other.Sessions[0], CategoryId: Other.Categories[0], Quantity: 2 }])).Status,
  );
  for (const Q of [0, -2, 1.5, 1e12]) {
    expect((await Group(A.Token, CustomerId, [{ SessionId: N1, CategoryId: Reg, Quantity: 2 }, { SessionId: N2, CategoryId: Reg, Quantity: Q }])).Status).toBe(400);
  }
  const Big = await NewEvent(A.Token, OrganizerId, ["2026-12-23T18:00:00Z", "2026-12-24T18:00:00Z"], [{ Name: "Hall", Price: "10.00", Capacity: 200 }]);
  const Hall = Big.Categories[0];
  expect((await Group(A.Token, CustomerId, [{ SessionId: Big.Sessions[0], CategoryId: Hall, Quantity: 60 }, { SessionId: Big.Sessions[1], CategoryId: Hall, Quantity: 41 }])).Status).toBe(400);
  expect(await Available(A.Token, Big.Id, Big.Sessions[0], Hall)).toBe(200);
  expect(Created((await Group(A.Token, CustomerId, [{ SessionId: Big.Sessions[0], CategoryId: Hall, Quantity: 60 }, { SessionId: Big.Sessions[1], CategoryId: Hall, Quantity: 40 }])).Status)).toBe(true);
  expect((await Group(A.Token, CustomerId, [])).Status).toBe(400);
  expect([400, 404]).toContain((await Group(A.Token, CustomerId, [{ SessionId: Huge, CategoryId: Reg, Quantity: 1 }])).Status);
  expect(await Available(A.Token, Event.Id, N1, Reg)).toBe(30);
  expect(await Available(A.Token, Event.Id, N1, Vip)).toBe(15);
  expect(await Available(A.Token, Event.Id, N2, Vip)).toBe(15);
  expect(await Available(A.Token, Other.Id, Other.Sessions[0], Other.Categories[0])).toBe(50);
});

test("r05: twenty tickets or more add the 5% group discount to the promo, still per ticket and floored", async () => {
  const { A, Event, CustomerId } = await Setup(Cats, Nights);
  const [N1, N2] = Event.Sessions;
  const [Vip, Reg] = Event.Categories;
  await PromoOk(A.Token, Event.Id, "SCHOOL10", 10);
  const Res = await Group(A.Token, CustomerId, [{ SessionId: N1, CategoryId: Vip, Quantity: 12 }, { SessionId: N2, CategoryId: Reg, Quantity: 8 }], "SCHOOL10");
  expect(Created(Res.Status)).toBe(true);
  const P = Res.Body.Data;
  expect(P.Tickets.length).toBe(20);
  expect(P.Tickets.filter((T: any) => T.SessionId === N1 && T.CategoryId === Vip).length).toBe(12);
  for (const T of P.Tickets) expect(Money(T.Price)).toBe(2834);
  expect(Money(P.Total)).toBe(56680);
  expect(Money(P.Discount)).toBe(9980);
  const Small = (await Group(A.Token, CustomerId, [{ SessionId: N1, CategoryId: Reg, Quantity: 19 }], "SCHOOL10")).Body.Data;
  expect(Small.Tickets.length).toBe(19);
  expect(Money(Small.Total)).toBe(19 * 3000);
  const NoPromo = (await Group(A.Token, CustomerId, [{ SessionId: N2, CategoryId: Reg, Quantity: 20 }])).Body.Data;
  expect(Money(NoPromo.Total)).toBe(20 * 3167);
  expect(await Available(A.Token, Event.Id, N1, Vip)).toBe(3);
  expect(await Available(A.Token, Event.Id, N2, Reg)).toBe(2);
});

test("r05: two parallel group bookings for the same last seats: one wins entirely", async () => {
  const { A, Event, CustomerId } = await Setup(Cats, Nights);
  const [N1, N2] = Event.Sessions;
  const [Vip, Reg] = Event.Categories;
  const Lines = [{ SessionId: N2, CategoryId: Reg, Quantity: 5 }, { SessionId: N1, CategoryId: Vip, Quantity: 9 }];
  const Both = await Promise.all([Group(A.Token, CustomerId, Lines), Group(A.Token, CustomerId, Lines)]);
  expect(Both.filter((R) => Created(R.Status)).length).toBe(1);
  expect(Both.filter((R) => R.Status === 409).length).toBe(1);
  expect(await Available(A.Token, Event.Id, N1, Vip)).toBe(6);
  expect(await Available(A.Token, Event.Id, N2, Reg)).toBe(25);
});

test("r05: another company's customer or event is not found", async () => {
  const { A, Event, CustomerId } = await Setup(Cats, Nights);
  const B = await NewCompany();
  const BCustomer = await NewCustomer(B.CompanyId);
  const Lines = [{ SessionId: Event.Sessions[0], CategoryId: Event.Categories[1], Quantity: 3 }];
  expect((await Group(A.Token, BCustomer, Lines)).Status).toBe(404);
  expect((await Group(B.Token, BCustomer, Lines)).Status).toBe(404);
  expect([400, 404]).toContain((await Group(A.Token, Huge, Lines)).Status);
  expect(Created((await Group(A.Token, CustomerId, Lines)).Status)).toBe(true);
  expect(await Available(A.Token, Event.Id, Event.Sessions[0], Event.Categories[1])).toBe(27);
});
