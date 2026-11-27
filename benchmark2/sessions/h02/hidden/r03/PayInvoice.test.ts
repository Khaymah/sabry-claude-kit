import { afterAll, beforeEach, expect, setSystemTime, test } from "bun:test";
import { At, Call, Created, FirstInvoice, GetInvoice, Huge, NewCompany, NewSubscription, Pay, Reset } from "../_Support";

let A: Awaited<ReturnType<typeof NewCompany>>;
let InvoiceId: number;

beforeEach(async () => {
  await Reset();
  At("2026-01-15T10:00:00Z");
  A = await NewCompany();
  const { SubscriptionId } = await NewSubscription(A.Token, A.CompanyId, 10000);
  InvoiceId = (await FirstInvoice(A.Token, SubscriptionId)).Id;
});

afterAll(() => setSystemTime());

test("r03: paying an invoice settles it once", async () => {
  expect(Created).toContain((await Pay(A.Token, InvoiceId, "Card")).Status);
  const Read = await GetInvoice(A.Token, InvoiceId);
  expect(Read.Status).toBe(200);
  expect(Read.Body.Data).toMatchObject({ Id: InvoiceId, Status: "Paid", Amount: 10000, AmountPaid: 10000 });
  expect((await Pay(A.Token, InvoiceId)).Status).toBe(409);
});

test("r03: a double click pays the invoice once", async () => {
  const Results = await Promise.all([Pay(A.Token, InvoiceId), Pay(A.Token, InvoiceId), Pay(A.Token, InvoiceId)]);
  expect(Results.filter((R) => Created.includes(R.Status)).length).toBe(1);
  expect(Results.filter((R) => R.Status === 409).length).toBe(2);
  expect((await GetInvoice(A.Token, InvoiceId)).Body.Data.AmountPaid).toBe(10000);
});

test("r03: other companies, unknown invoices and bad methods are refused", async () => {
  const B = await NewCompany();
  expect((await Pay(B.Token, InvoiceId)).Status).toBe(404);
  expect((await GetInvoice(B.Token, InvoiceId)).Status).toBe(404);
  expect([400, 404]).toContain((await Pay(A.Token, Huge)).Status);
  expect([400, 404]).toContain((await GetInvoice(A.Token, Huge)).Status);
  expect((await Pay(A.Token, InvoiceId, "Bitcoin")).Status).toBe(400);
  expect((await Call("POST", `/Invoices/${InvoiceId}/Pay`, { Token: A.Token, Body: {} })).Status).toBe(400);
  expect((await GetInvoice(A.Token, InvoiceId)).Body.Data).toMatchObject({ Status: "Open", AmountPaid: 0 });
});
