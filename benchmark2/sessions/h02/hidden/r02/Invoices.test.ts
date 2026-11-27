import { afterAll, beforeEach, expect, setSystemTime, test } from "bun:test";
import { At, Call, Invoices, NewCompany, NewSubscription, Reset, RunBilling } from "../_Support";

let A: Awaited<ReturnType<typeof NewCompany>>;

beforeEach(async () => {
  await Reset();
  At("2026-01-15T10:00:00Z");
  A = await NewCompany();
});

afterAll(() => setSystemTime());

test("r02: subscribing issues the first monthly invoice in piasters", async () => {
  const { SubscriptionId } = await NewSubscription(A.Token, A.CompanyId, 10000);
  const List = await Invoices(A.Token, SubscriptionId);
  expect(List.length).toBe(1);
  expect(List[0].Amount).toBe(10000);
  expect(List[0].Status).toBe("Open");
  expect(List[0].SubscriptionId).toBe(SubscriptionId);
  expect(String(List[0].PeriodStart).slice(0, 10)).toBe("2026-01-15");
  expect(String(List[0].PeriodEnd).slice(0, 10)).toBe("2026-02-15");
});

test("r02: a longer plan is split monthly and the leftover lands on the last invoice of the cycle", async () => {
  const Yearly = await NewSubscription(A.Token, A.CompanyId, 100000, 12);
  const Quarterly = await NewSubscription(A.Token, A.CompanyId, 10000, 3);
  At("2026-12-20T10:00:00Z");
  expect((await RunBilling(A.Token)).Status).toBe(200);
  const Year = await Invoices(A.Token, Yearly.SubscriptionId);
  expect(Year.map((I) => I.Amount)).toEqual([...Array(11).fill(8333), 8337]);
  const Quarter = await Invoices(A.Token, Quarterly.SubscriptionId);
  expect(Quarter.map((I) => I.Amount)).toEqual([3333, 3333, 3334, 3333, 3333, 3334, 3333, 3333, 3334, 3333, 3333, 3334]);
  At("2027-01-16T10:00:00Z");
  await RunBilling(A.Token);
  const Next = await Invoices(A.Token, Yearly.SubscriptionId);
  expect(Next.length).toBe(13);
  expect(Next[12].Amount).toBe(8333);
  expect(String(Next[12].PeriodStart).slice(0, 10)).toBe("2027-01-15");
});

test("r02: billing catches up on missed months and running it again issues nothing twice", async () => {
  const { SubscriptionId } = await NewSubscription(A.Token, A.CompanyId, 10000);
  At("2026-04-20T10:00:00Z");
  const Runs = await Promise.all([RunBilling(A.Token), RunBilling(A.Token), RunBilling(A.Token)]);
  for (const R of Runs) expect(R.Status).toBe(200);
  await RunBilling(A.Token);
  const List = await Invoices(A.Token, SubscriptionId);
  expect(List.map((I) => String(I.PeriodStart).slice(0, 10))).toEqual(["2026-01-15", "2026-02-15", "2026-03-15", "2026-04-15"]);
  expect(List.every((I) => I.Amount === 10000)).toBe(true);
});

test("r02: billing and invoices stay inside the company", async () => {
  const B = await NewCompany();
  const Mine = await NewSubscription(A.Token, A.CompanyId, 10000);
  const Theirs = await NewSubscription(B.Token, B.CompanyId, 5000);
  At("2026-03-20T10:00:00Z");
  await RunBilling(A.Token);
  expect((await Invoices(A.Token, Mine.SubscriptionId)).length).toBe(3);
  expect((await Invoices(B.Token, Theirs.SubscriptionId)).length).toBe(1);
  expect((await Call("GET", `/Subscriptions/${Mine.SubscriptionId}/Invoices`, { Token: B.Token })).Status).toBe(404);
});
