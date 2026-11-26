import { afterAll, beforeEach, expect, setSystemTime, test } from "bun:test";
import { ApplyCoupon, At, Call, Created, FirstInvoice, GetInvoice, NewCompany, NewCoupon, NewSubscription, Pay, Reset } from "../_Support";

let A: Awaited<ReturnType<typeof NewCompany>>;

beforeEach(async () => {
  await Reset();
  At("2026-01-15T10:00:00Z");
  A = await NewCompany();
});

afterAll(() => setSystemTime());

async function OpenInvoice(Price: number, IntervalMonths = 1) {
  const { SubscriptionId } = await NewSubscription(A.Token, A.CompanyId, Price, IntervalMonths);
  return (await FirstInvoice(A.Token, SubscriptionId)).Id as number;
}

test("r04: a coupon discounts the invoice and the customer pays the rounded amount", async () => {
  expect(Created).toContain((await NewCoupon(A.Token, "SAVE15", 15)).Status);
  expect(Created).toContain((await NewCoupon(A.Token, "SAVE43", 43)).Status);
  const First = await OpenInvoice(100000, 12);
  expect([200, 201]).toContain((await ApplyCoupon(A.Token, First, "SAVE15")).Status);
  expect((await GetInvoice(A.Token, First)).Body.Data).toMatchObject({ Amount: 7083, Discount: 1250 });
  const Second = await OpenInvoice(10000);
  expect([200, 201]).toContain((await ApplyCoupon(A.Token, Second, "SAVE43")).Status);
  expect((await GetInvoice(A.Token, Second)).Body.Data).toMatchObject({ Amount: 5700, Discount: 4300 });
  expect(Created).toContain((await Pay(A.Token, First)).Status);
  expect((await GetInvoice(A.Token, First)).Body.Data.AmountPaid).toBe(7083);
});

test("r04: a coupon is never used more than its limit, even in parallel", async () => {
  expect(Created).toContain((await NewCoupon(A.Token, "TWO", 10, 2)).Status);
  const Ids = [];
  for (let I = 0; I < 5; I++) Ids.push(await OpenInvoice(10000));
  const Results = await Promise.all(Ids.slice(0, 4).map((Id) => ApplyCoupon(A.Token, Id, "TWO")));
  expect(Results.filter((R) => [200, 201].includes(R.Status)).length).toBe(2);
  expect(Results.filter((R) => R.Status === 409).length).toBe(2);
  expect((await ApplyCoupon(A.Token, Ids[4], "TWO")).Status).toBe(409);
  const Amounts = [];
  for (const Id of Ids) Amounts.push((await GetInvoice(A.Token, Id)).Body.Data.Amount);
  expect(Amounts.filter((V) => V === 9000).length).toBe(2);
  expect(Amounts.filter((V) => V === 10000).length).toBe(3);
});

test("r04: one coupon per open invoice, and only the company's own coupons", async () => {
  const B = await NewCompany();
  expect(Created).toContain((await NewCoupon(A.Token, "HALF", 50)).Status);
  expect(Created).toContain((await NewCoupon(A.Token, "TEN", 10)).Status);
  expect((await NewCoupon(A.Token, "HALF", 20)).Status).toBe(409);
  expect(Created).toContain((await NewCoupon(B.Token, "HALF", 90)).Status);
  expect(Created).toContain((await NewCoupon(B.Token, "THEIRS", 90)).Status);
  for (const [PercentOff, MaxRedemptions] of [[0, 1], [101, 1], [12.5, 1], [10, 0]])
    expect((await Call("POST", "/Coupons", { Token: A.Token, Body: { Code: `X${PercentOff}${MaxRedemptions}`, PercentOff, MaxRedemptions } })).Status).toBe(400);
  const Id = await OpenInvoice(10000);
  expect([400, 404, 409]).toContain((await ApplyCoupon(A.Token, Id, "THEIRS")).Status);
  expect([400, 404, 409]).toContain((await ApplyCoupon(A.Token, Id, "NOPE")).Status);
  expect((await GetInvoice(A.Token, Id)).Body.Data.Amount).toBe(10000);
  expect([200, 201]).toContain((await ApplyCoupon(A.Token, Id, "HALF")).Status);
  expect((await ApplyCoupon(A.Token, Id, "TEN")).Status).toBe(409);
  expect((await GetInvoice(A.Token, Id)).Body.Data.Amount).toBe(5000);
  const Paid = await OpenInvoice(10000);
  await Pay(A.Token, Paid);
  expect((await ApplyCoupon(A.Token, Paid, "TEN")).Status).toBe(409);
  expect((await GetInvoice(A.Token, Paid)).Body.Data.AmountPaid).toBe(10000);
});
