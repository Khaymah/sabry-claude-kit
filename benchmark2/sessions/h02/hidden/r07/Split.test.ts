import { afterAll, beforeEach, expect, setSystemTime, test } from "bun:test";
import { ApplyCoupon, At, Created, FirstInvoice, GetInvoice, Huge, Invoices, NewCompany, NewCoupon, NewSubscription, Pay, Reset, RunBilling, Split } from "../_Support";

let A: Awaited<ReturnType<typeof NewCompany>>;

beforeEach(async () => {
  await Reset();
  At("2026-01-15T10:00:00Z");
  A = await NewCompany();
});

afterAll(() => setSystemTime());

async function OpenInvoice(Price: number, IntervalMonths = 1) {
  const { SubscriptionId } = await NewSubscription(A.Token, A.CompanyId, Price, IntervalMonths);
  return { SubscriptionId, Id: (await FirstInvoice(A.Token, SubscriptionId)).Id as number };
}

test("r07: splitting puts the leftover on the last part and voids the original", async () => {
  const One = await OpenInvoice(10000);
  const Res = await Split(A.Token, One.Id, 3);
  expect([200, 201]).toContain(Res.Status);
  const Parts = Res.Body.Data.Invoices;
  expect(Parts.map((I: any) => I.Amount)).toEqual([3333, 3333, 3334]);
  expect(Parts.every((I: any) => I.Status === "Open")).toBe(true);
  const Dates = Parts.map((I: any) => String(I.DueDate).slice(0, 10));
  expect(Dates[0]).toBe("2026-01-15");
  expect(new Set(Dates).size).toBe(3);
  expect([...Dates].sort()).toEqual(Dates);
  const Two = await OpenInvoice(10001, 3);
  expect((await GetInvoice(A.Token, Two.Id)).Body.Data.Amount).toBe(3333);
  expect((await Split(A.Token, Two.Id, 2)).Body.Data.Invoices.map((I: any) => I.Amount)).toEqual([1666, 1667]);
  expect((await GetInvoice(A.Token, One.Id)).Body.Data.Status).toBe("Void");
  expect([404, 409]).toContain((await Pay(A.Token, One.Id)).Status);
});

test("r07: the parts are ordinary invoices of the subscription and billing does not bring the original back", async () => {
  expect(Created).toContain((await NewCoupon(A.Token, "Q", 25)).Status);
  const One = await OpenInvoice(10000);
  await ApplyCoupon(A.Token, One.Id, "Q");
  const Parts = (await Split(A.Token, One.Id, 4)).Body.Data.Invoices;
  expect(Parts.map((I: any) => I.Amount)).toEqual([1875, 1875, 1875, 1875]);
  const Live = async () => (await Invoices(A.Token, One.SubscriptionId)).filter((I) => I.Status !== "Void");
  expect((await Live()).reduce((S, I) => S + I.Amount, 0)).toBe(7500);
  await RunBilling(A.Token);
  expect((await Live()).reduce((S, I) => S + I.Amount, 0)).toBe(7500);
  expect(Created).toContain((await Pay(A.Token, Parts[0].Id)).Status);
  expect((await GetInvoice(A.Token, Parts[0].Id)).Body.Data).toMatchObject({ Status: "Paid", AmountPaid: 1875 });
  At("2026-02-16T10:00:00Z");
  await RunBilling(A.Token);
  const After = await Live();
  expect(After.length).toBe(5);
  expect(After.reduce((S, I) => S + I.Amount, 0)).toBe(17500);
});

test("r07: only open invoices of my company can be split", async () => {
  const B = await NewCompany();
  const One = await OpenInvoice(10000);
  for (const Parts of [1, 7, 2.5, "3"]) expect((await Split(A.Token, One.Id, Parts)).Status).toBe(400);
  expect((await Split(B.Token, One.Id, 2)).Status).toBe(404);
  expect([400, 404]).toContain((await Split(A.Token, Huge, 2)).Status);
  const Paid = await OpenInvoice(10000);
  await Pay(A.Token, Paid.Id);
  expect((await Split(A.Token, Paid.Id, 2)).Status).toBe(409);
  expect([200, 201]).toContain((await Split(A.Token, One.Id, 2)).Status);
  expect((await Split(A.Token, One.Id, 2)).Status).toBe(409);
  expect((await Invoices(A.Token, One.SubscriptionId)).length).toBe(3);
});
