import { beforeEach, expect, test } from "bun:test";
import { Call, NewCompany, NewCustomer, Reset, Sql } from "./_Support";

let A: Awaited<ReturnType<typeof NewCompany>>;
let Customer: number;

beforeEach(async () => {
  await Reset();
  A = await NewCompany();
  Customer = await NewCustomer(A.CompanyId);
});

const Cents = (V: string) => {
  expect(V).toMatch(/^\d+\.\d{2}$/);
  return Math.round(Number(V) * 100);
};

async function Order(Subtotal: string, Tax: string, Total: string) {
  const [Row] = await Sql<{ Id: number }>(
    `INSERT INTO "Orders" ("CompanyId","CustomerId","Status","Subtotal","Tax","Total") VALUES ($1,$2,'Pending',$3,$4,$5) RETURNING "Id"`,
    [A.CompanyId, Customer, Subtotal, Tax, Total],
  );
  return Row.Id;
}

async function Pay(OrderId: number, Amount: string) {
  const Res = await Call("POST", "/Payments", { Token: A.Token, Body: { OrderId, Amount, Method: "Cash" } });
  expect(Res.Status).toBe(201);
  return Res.Body.Data.Id as number;
}

const Receipt = async (Id: number, Token = A.Token) => Call("GET", `/Payments/${Id}/Receipt`, { Token });

async function CheckReceipts(Ids: number[], Amounts: string[], Tax: string, Total: string) {
  let VatSum = 0;
  for (const [I, Id] of Ids.entries()) {
    const R = (await Receipt(Id)).Body.Data;
    expect(R.Amount).toBe(Amounts[I]);
    expect(Cents(R.NetAmount) + Cents(R.VatAmount)).toBe(Cents(Amounts[I]));
    const Ideal = (Cents(Amounts[I]) * Cents(Tax)) / Cents(Total);
    expect(Math.abs(Cents(R.VatAmount) - Ideal)).toBeLessThanOrEqual(1);
    VatSum += Cents(R.VatAmount);
  }
  return VatSum;
}

test("VAT on the receipts of equal installments adds up to the invoice VAT", async () => {
  const OrderId = await Order("100.00", "14.00", "114.00");
  const Ids = [await Pay(OrderId, "38.00"), await Pay(OrderId, "38.00"), await Pay(OrderId, "38.00")];
  expect(await CheckReceipts(Ids, ["38.00", "38.00", "38.00"], "14.00", "114.00")).toBe(1400);
});

test("uneven installments also add up exactly", async () => {
  const OrderId = await Order("87.72", "12.28", "100.00");
  const Amounts = ["33.33", "33.33", "0.01", "33.33"];
  const Ids = [];
  for (const A_ of Amounts) Ids.push(await Pay(OrderId, A_));
  expect(await CheckReceipts(Ids, Amounts, "12.28", "100.00")).toBe(1228);
});

test("a receipt never changes after later payments", async () => {
  const OrderId = await Order("100.00", "14.00", "114.00");
  const First = await Pay(OrderId, "38.00");
  const Before = (await Receipt(First)).Body.Data;
  await Pay(OrderId, "38.00");
  await Pay(OrderId, "38.00");
  const After = (await Receipt(First)).Body.Data;
  expect([After.Amount, After.NetAmount, After.VatAmount]).toEqual([Before.Amount, Before.NetAmount, Before.VatAmount]);
});

test("the invoice lists each payment's VAT and the remaining balance", async () => {
  const OrderId = await Order("100.00", "14.00", "114.00");
  const P1 = await Pay(OrderId, "38.00");
  const P2 = await Pay(OrderId, "38.00");
  const Res = await Call("GET", `/Orders/${OrderId}/Invoice`, { Token: A.Token });
  expect(Res.Status).toBe(200);
  expect(Res.Body.Data).toMatchObject({ Subtotal: "100.00", Tax: "14.00", Total: "114.00", Balance: "38.00" });
  const Lines = Res.Body.Data.Payments;
  expect(Lines.map((L: any) => L.PaymentId)).toEqual([P1, P2]);
  for (const L of Lines) expect(L.VatAmount).toBe((await Receipt(L.PaymentId)).Body.Data.VatAmount);
  const P3 = await Pay(OrderId, "38.00");
  const Final = (await Call("GET", `/Orders/${OrderId}/Invoice`, { Token: A.Token })).Body.Data;
  expect(Final.Balance).toBe("0.00");
  expect(Final.Payments.reduce((S: number, L: any) => S + Cents(L.VatAmount), 0)).toBe(1400);
  expect(Final.Payments.map((L: any) => L.PaymentId)).toEqual([P1, P2, P3]);
});

test("receipts and invoices of another company are not visible", async () => {
  const OrderId = await Order("100.00", "14.00", "114.00");
  const P1 = await Pay(OrderId, "114.00");
  const B = await NewCompany();
  expect((await Receipt(P1, B.Token)).Status).toBe(404);
  expect((await Call("GET", `/Orders/${OrderId}/Invoice`, { Token: B.Token })).Status).toBe(404);
});
