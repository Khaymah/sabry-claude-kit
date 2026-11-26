import { afterAll, beforeEach, expect, setSystemTime, test } from "bun:test";
import { ApplyCoupon, At, Call, Created, FirstInvoice, GetInvoice, Huge, NewCompany, NewCoupon, NewCustomer, NewPlan, NewSubscription, Pay, Refund, Reset, Subscribe } from "../_Support";

let A: Awaited<ReturnType<typeof NewCompany>>;

beforeEach(async () => {
  await Reset();
  At("2026-04-01T09:00:00Z");
  A = await NewCompany();
});

afterAll(() => setSystemTime());

async function PaidInvoice(Price = 10000) {
  const { SubscriptionId } = await NewSubscription(A.Token, A.CompanyId, Price);
  const Id = (await FirstInvoice(A.Token, SubscriptionId)).Id as number;
  expect(Created).toContain((await Pay(A.Token, Id)).Status);
  return Id;
}

test("r06: partial refunds add up to what was paid and never more", async () => {
  const Id = await PaidInvoice();
  expect(Created).toContain((await Refund(A.Token, Id, 3000)).Status);
  expect(Created).toContain((await Refund(A.Token, Id, 5000)).Status);
  expect((await Refund(A.Token, Id, 2500)).Status).toBe(409);
  expect(Created).toContain((await Refund(A.Token, Id, 2000)).Status);
  expect((await Refund(A.Token, Id, 1)).Status).toBe(409);
  expect((await GetInvoice(A.Token, Id)).Body.Data).toMatchObject({ AmountPaid: 10000, AmountRefunded: 10000 });
});

test("r06: parallel refunds cannot go past the payment", async () => {
  const Id = await PaidInvoice();
  const Results = await Promise.all([Refund(A.Token, Id, 6000), Refund(A.Token, Id, 6000), Refund(A.Token, Id, 6000)]);
  expect(Results.filter((R) => Created.includes(R.Status)).length).toBe(1);
  expect((await GetInvoice(A.Token, Id)).Body.Data.AmountRefunded).toBe(6000);
});

test("r06: the refund limit is what the customer actually paid, after a coupon or an upgrade", async () => {
  expect(Created).toContain((await NewCoupon(A.Token, "HALF", 50)).Status);
  const { SubscriptionId } = await NewSubscription(A.Token, A.CompanyId, 10000);
  const Discounted = (await FirstInvoice(A.Token, SubscriptionId)).Id;
  await ApplyCoupon(A.Token, Discounted, "HALF");
  expect(Created).toContain((await Pay(A.Token, Discounted)).Status);
  expect((await Refund(A.Token, Discounted, 5001)).Status).toBe(409);
  expect(Created).toContain((await Refund(A.Token, Discounted, 5000)).Status);
  const Basic = await NewPlan(A.Token, 10000);
  const Pro = await NewPlan(A.Token, 17000);
  const Sub = (await Subscribe(A.Token, await NewCustomer(A.CompanyId), Basic)).Body.Data.Id;
  At("2026-04-11T12:00:00Z");
  const Extra = (await Call("POST", `/Subscriptions/${Sub}/ChangePlan`, { Token: A.Token, Body: { PlanId: Pro } })).Body.Data.Invoice.Id;
  expect(Created).toContain((await Pay(A.Token, Extra)).Status);
  expect((await Refund(A.Token, Extra, 4667)).Status).toBe(409);
  expect(Created).toContain((await Refund(A.Token, Extra, 4666)).Status);
  expect((await GetInvoice(A.Token, Extra)).Body.Data.AmountRefunded).toBe(4666);
});

test("r06: bad refunds are rejected cleanly", async () => {
  const Id = await PaidInvoice();
  for (const Amount of [-5, 0, 10.5, "100", null]) expect((await Refund(A.Token, Id, Amount)).Status).toBe(400);
  expect([400, 409]).toContain((await Refund(A.Token, Id, 1e15)).Status);
  const { SubscriptionId } = await NewSubscription(A.Token, A.CompanyId, 10000);
  expect((await Refund(A.Token, (await FirstInvoice(A.Token, SubscriptionId)).Id, 100)).Status).toBe(409);
  const B = await NewCompany();
  expect((await Refund(B.Token, Id, 100)).Status).toBe(404);
  expect([400, 404]).toContain((await Refund(A.Token, Huge, 100)).Status);
  expect((await GetInvoice(A.Token, Id)).Body.Data.AmountRefunded).toBe(0);
});
