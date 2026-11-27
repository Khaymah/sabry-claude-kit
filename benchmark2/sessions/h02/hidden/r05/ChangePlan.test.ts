import { afterAll, beforeEach, expect, setSystemTime, test } from "bun:test";
import { At, Call, Created, Huge, Invoices, NewCompany, NewCustomer, NewPlan, Pay, Reset, RunBilling, Subscribe } from "../_Support";

let A: Awaited<ReturnType<typeof NewCompany>>;

beforeEach(async () => {
  await Reset();
  A = await NewCompany();
});

afterAll(() => setSystemTime());

const Change = (Token: string, SubscriptionId: number, PlanId: unknown) => Call("POST", `/Subscriptions/${SubscriptionId}/ChangePlan`, { Token, Body: { PlanId } });

async function SubscribeTo(PlanId: number) {
  const Res = await Subscribe(A.Token, await NewCustomer(A.CompanyId), PlanId);
  expect(Created).toContain(Res.Status);
  return Res.Body.Data.Id as number;
}

test("r05: upgrading mid-period bills the price difference for the days left", async () => {
  At("2026-02-01T09:00:00Z");
  const Small = await NewPlan(A.Token, 9900);
  const Large = await NewPlan(A.Token, 12900);
  const Feb = await SubscribeTo(Small);
  At("2026-02-10T15:00:00Z");
  const FebRes = await Change(A.Token, Feb, Large);
  expect([200, 201]).toContain(FebRes.Status);
  expect(FebRes.Body.Data.Invoice.Amount).toBe(2035);
  At("2026-04-01T09:00:00Z");
  const Basic = await NewPlan(A.Token, 10000);
  const Pro = await NewPlan(A.Token, 17000);
  const Sub = await SubscribeTo(Basic);
  At("2026-04-11T12:00:00Z");
  const Res = await Change(A.Token, Sub, Pro);
  expect([200, 201]).toContain(Res.Status);
  expect(Res.Body.Data.Subscription.PlanId).toBe(Pro);
  const Extra = Res.Body.Data.Invoice;
  expect(Extra.Amount).toBe(4666);
  expect(Extra.Status).toBe("Open");
  expect((await Call("GET", `/Subscriptions/${Sub}`, { Token: A.Token })).Body.Data.PlanId).toBe(Pro);
  const List = await Invoices(A.Token, Sub);
  expect(List.map((I) => I.Amount).sort((X, Y) => X - Y)).toEqual([4666, 10000]);
  expect(Created).toContain((await Pay(A.Token, Extra.Id)).Status);
});

test("r05: the next period is billed at the new price", async () => {
  At("2026-04-01T09:00:00Z");
  const Sub = await SubscribeTo(await NewPlan(A.Token, 10000));
  const Pro = await NewPlan(A.Token, 17000);
  At("2026-04-11T12:00:00Z");
  expect([200, 201]).toContain((await Change(A.Token, Sub, Pro)).Status);
  At("2026-05-02T09:00:00Z");
  await RunBilling(A.Token);
  const List = await Invoices(A.Token, Sub);
  const May = List.filter((I) => String(I.PeriodStart).slice(0, 10) === "2026-05-01");
  expect(May.map((I) => I.Amount)).toEqual([17000]);
  expect(List.reduce((S, I) => S + I.Amount, 0)).toBe(10000 + 4666 + 17000);
});

test("r05: only upgrades between the company's monthly plans are allowed", async () => {
  At("2026-04-01T09:00:00Z");
  const B = await NewCompany();
  const Basic = await NewPlan(A.Token, 10000);
  const Cheap = await NewPlan(A.Token, 5000);
  const Yearly = await NewPlan(A.Token, 500000, 12);
  const Theirs = await NewPlan(B.Token, 90000);
  const Sub = await SubscribeTo(Basic);
  const YearSub = await SubscribeTo(Yearly);
  At("2026-04-11T12:00:00Z");
  expect((await Change(A.Token, Sub, Cheap)).Status).toBe(409);
  expect((await Change(A.Token, Sub, Basic)).Status).toBe(409);
  expect((await Change(A.Token, Sub, Yearly)).Status).toBe(409);
  expect((await Change(A.Token, YearSub, await NewPlan(A.Token, 900000))).Status).toBe(409);
  expect((await Change(A.Token, Sub, Theirs)).Status).toBe(404);
  expect((await Change(B.Token, Sub, Theirs)).Status).toBe(404);
  expect([400, 404]).toContain((await Change(A.Token, Sub, Huge)).Status);
  expect((await Call("GET", `/Subscriptions/${Sub}`, { Token: A.Token })).Body.Data.PlanId).toBe(Basic);
  expect((await Invoices(A.Token, Sub)).length).toBe(1);
});
