import { afterAll, beforeEach, expect, setSystemTime, test } from "bun:test";
import { At, Call, Created, Huge, NewCompany, NewCustomer, NewPlan, Reset, Subscribe } from "../_Support";

let A: Awaited<ReturnType<typeof NewCompany>>;

beforeEach(async () => {
  await Reset();
  At("2026-01-15T10:00:00Z");
  A = await NewCompany();
});

afterAll(() => setSystemTime());

test("r01: plans belong to the company and a customer subscribes from today", async () => {
  const Res = await Call("POST", "/Plans", { Token: A.Token, Body: { Name: "Gold", Price: 15000, IntervalMonths: 3 } });
  expect(Created).toContain(Res.Status);
  const PlanId = Res.Body.Data.Id;
  const B = await NewCompany();
  await NewPlan(B.Token, 999);
  const Mine = (await Call("GET", "/Plans", { Token: A.Token })).Body.Data;
  const List = Array.isArray(Mine) ? Mine : Mine.Items;
  expect(List.length).toBe(1);
  expect(List[0]).toMatchObject({ Id: PlanId, Price: 15000, IntervalMonths: 3 });
  const CustomerId = await NewCustomer(A.CompanyId);
  const Sub = await Subscribe(A.Token, CustomerId, PlanId);
  expect(Created).toContain(Sub.Status);
  expect(Sub.Body.Data).toMatchObject({ CustomerId, PlanId, Status: "Active" });
  expect(String(Sub.Body.Data.StartDate).slice(0, 10)).toBe("2026-01-15");
  const Read = await Call("GET", `/Subscriptions/${Sub.Body.Data.Id}`, { Token: A.Token });
  expect(Read.Status).toBe(200);
  expect(Read.Body.Data).toMatchObject({ Id: Sub.Body.Data.Id, CustomerId, PlanId, Status: "Active" });
});

test("r01: bad plans are refused and big prices never crash", async () => {
  const Bad = [
    { Name: "X", Price: -100, IntervalMonths: 1 },
    { Name: "X", Price: 0, IntervalMonths: 1 },
    { Name: "X", Price: 99.5, IntervalMonths: 1 },
    { Name: "X", Price: "100", IntervalMonths: 1 },
    { Name: "X", Price: 100, IntervalMonths: 2 },
    { Name: "X", Price: 100, IntervalMonths: 0 },
    { Price: 100, IntervalMonths: 1 },
  ];
  for (const Body of Bad) expect((await Call("POST", "/Plans", { Token: A.Token, Body })).Status).toBe(400);
  const Big = await Call("POST", "/Plans", { Token: A.Token, Body: { Name: "Enterprise", Price: 5_000_000_000, IntervalMonths: 12 } });
  expect([200, 201, 400]).toContain(Big.Status);
  if (Big.Status !== 400) {
    const List = (await Call("GET", "/Plans", { Token: A.Token })).Body.Data;
    expect((Array.isArray(List) ? List : List.Items).find((P: any) => P.Id === Big.Body.Data.Id).Price).toBe(5_000_000_000);
  }
});

test("r01: a customer gets one active subscription even on a double click", async () => {
  const PlanId = await NewPlan(A.Token, 10000);
  const CustomerId = await NewCustomer(A.CompanyId);
  const Results = await Promise.all([Subscribe(A.Token, CustomerId, PlanId), Subscribe(A.Token, CustomerId, PlanId), Subscribe(A.Token, CustomerId, PlanId)]);
  expect(Results.filter((R) => Created.includes(R.Status)).length).toBe(1);
  expect(Results.filter((R) => R.Status === 409).length).toBe(2);
  expect((await Subscribe(A.Token, CustomerId, await NewPlan(A.Token, 20000))).Status).toBe(409);
});

test("r01: other companies' customers, plans and subscriptions are out of reach", async () => {
  const B = await NewCompany();
  const PlanA = await NewPlan(A.Token, 10000);
  const PlanB = await NewPlan(B.Token, 10000);
  const CustomerA = await NewCustomer(A.CompanyId);
  expect((await Subscribe(B.Token, CustomerA, PlanB)).Status).toBe(404);
  expect((await Subscribe(A.Token, CustomerA, PlanB)).Status).toBe(404);
  expect([400, 404]).toContain((await Subscribe(A.Token, CustomerA, Huge)).Status);
  expect([400, 404]).toContain((await Subscribe(A.Token, Huge, PlanA)).Status);
  const Sub = await Subscribe(A.Token, CustomerA, PlanA);
  expect(Created).toContain(Sub.Status);
  expect((await Call("GET", `/Subscriptions/${Sub.Body.Data.Id}`, { Token: B.Token })).Status).toBe(404);
  expect([400, 404]).toContain((await Call("GET", `/Subscriptions/${Huge}`, { Token: A.Token })).Status);
});
