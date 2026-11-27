import { afterAll, beforeEach, expect, setSystemTime, test } from "bun:test";
import { ApplyCoupon, At, Call, Created, FirstInvoice, NewCompany, NewCoupon, NewSubscription, Pay, Refund, Reset, Revenue, Split } from "../_Support";

let A: Awaited<ReturnType<typeof NewCompany>>;

beforeEach(async () => {
  await Reset();
  At("2026-01-14T12:00:00Z");
  A = await NewCompany();
});

afterAll(() => setSystemTime());

async function OpenInvoice(Token: string, CompanyId: number, Price: number) {
  const { SubscriptionId } = await NewSubscription(Token, CompanyId, Price);
  return (await FirstInvoice(Token, SubscriptionId)).Id as number;
}

const Day = async (Token: string, Date: string) => {
  const Res = await Revenue(Token, Date);
  expect(Res.Status).toBe(200);
  return Res.Body.Data;
};

test("r08: the day's collections minus refunds, by Cairo time and per company", async () => {
  const B = await NewCompany();
  const I1 = await OpenInvoice(A.Token, A.CompanyId, 10000);
  const I2 = await OpenInvoice(A.Token, A.CompanyId, 10000);
  const I3 = await OpenInvoice(A.Token, A.CompanyId, 10000);
  const I4 = await OpenInvoice(A.Token, A.CompanyId, 10000);
  const IB = await OpenInvoice(B.Token, B.CompanyId, 7777);
  expect(Created).toContain((await NewCoupon(A.Token, "HALF", 50)).Status);
  At("2026-01-14T23:00:00Z");
  expect(Created).toContain((await Pay(A.Token, I1)).Status);
  At("2026-01-15T09:00:00Z");
  await ApplyCoupon(A.Token, I2, "HALF");
  expect(Created).toContain((await Pay(A.Token, I2)).Status);
  await Promise.all([Pay(A.Token, I3), Pay(A.Token, I3), Pay(A.Token, I3)]);
  expect(Created).toContain((await Refund(A.Token, I1, 1500)).Status);
  expect(Created).toContain((await Pay(B.Token, IB)).Status);
  At("2026-01-15T22:30:00Z");
  expect(Created).toContain((await Pay(A.Token, I4)).Status);
  expect(await Day(A.Token, "2026-01-15")).toMatchObject({ Collected: 25000, Refunded: 1500, Net: 23500 });
  expect(String((await Day(A.Token, "2026-01-15")).Date).slice(0, 10)).toBe("2026-01-15");
  expect(await Day(A.Token, "2026-01-16")).toMatchObject({ Collected: 10000, Refunded: 0, Net: 10000 });
  expect(await Day(A.Token, "2026-01-14")).toMatchObject({ Collected: 0, Refunded: 0, Net: 0 });
  expect(await Day(B.Token, "2026-01-15")).toMatchObject({ Collected: 7777, Refunded: 0, Net: 7777 });
});

test("r08: refunds count on the day they are made, split parts count when paid", async () => {
  const I1 = await OpenInvoice(A.Token, A.CompanyId, 10000);
  const I2 = await OpenInvoice(A.Token, A.CompanyId, 10001);
  At("2026-01-15T10:00:00Z");
  await Pay(A.Token, I1);
  At("2026-01-17T10:00:00Z");
  expect(Created).toContain((await Refund(A.Token, I1, 2000)).Status);
  const Parts = (await Split(A.Token, I2, 2)).Body.Data.Invoices;
  expect(Created).toContain((await Pay(A.Token, Parts[1].Id)).Status);
  expect(await Day(A.Token, "2026-01-15")).toMatchObject({ Collected: 10000, Refunded: 0, Net: 10000 });
  expect(await Day(A.Token, "2026-01-17")).toMatchObject({ Collected: 5001, Refunded: 2000, Net: 3001 });
});

test("r08: bad dates are rejected", async () => {
  for (const Q of ["Date=2026-02-30", "Date=2026-13-01", "Date=abc", "Date=", ""])
    expect((await Call("GET", `/Reports/DailyRevenue?${Q}`, { Token: A.Token })).Status).toBe(400);
});
