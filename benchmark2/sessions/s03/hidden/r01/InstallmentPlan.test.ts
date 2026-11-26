import { beforeEach, expect, test } from "bun:test";
import { Call, Cents, NewCompany, NewCustomer, NewOrder, Plan, Reset, Sql } from "../_Support";

let A: Awaited<ReturnType<typeof NewCompany>>;
let Customer: number;

beforeEach(async () => {
  await Reset();
  A = await NewCompany();
  Customer = await NewCustomer(A.CompanyId);
});

test("r01: an order is split into installments that add up exactly", async () => {
  const OrderId = await NewOrder(A.CompanyId, Customer, "100.00");
  const Res = await Plan(A.Token, OrderId, 3);
  expect(Res.Status).toBe(201);
  const Items = Res.Body.Data.Installments;
  expect(Items.map((I: any) => I.No)).toEqual([1, 2, 3]);
  const Amounts = Items.map((I: any) => Cents(I.Amount));
  expect(Amounts.reduce((S: number, V: number) => S + V, 0)).toBe(10000);
  expect(Math.max(...Amounts) - Math.min(...Amounts)).toBeLessThanOrEqual(1);
  const Read = await Call("GET", `/Orders/${OrderId}/InstallmentPlan`, { Token: A.Token });
  expect(Read.Body.Data.Installments.map((I: any) => I.Amount)).toEqual(Items.map((I: any) => I.Amount));
});

test("r01: installments are due today and then monthly", async () => {
  const OrderId = await NewOrder(A.CompanyId, Customer, "120.00");
  const Items = (await Plan(A.Token, OrderId, 4)).Body.Data.Installments;
  const Dates = Items.map((I: any) => new Date(`${String(I.DueDate).slice(0, 10)}T00:00:00Z`));
  expect(Math.abs(Dates[0].getTime() - Date.now())).toBeLessThan(2 * 86400_000);
  for (let I = 1; I < Dates.length; I++) {
    const Months = (Dates[I].getUTCFullYear() - Dates[I - 1].getUTCFullYear()) * 12 + Dates[I].getUTCMonth() - Dates[I - 1].getUTCMonth();
    expect(Months).toBe(1);
  }
});

test("r01: only what is still unpaid is split", async () => {
  const OrderId = await NewOrder(A.CompanyId, Customer, "114.00");
  await Sql(`INSERT INTO "Payments" ("CompanyId","OrderId","Amount","Method") VALUES ($1,$2,'14.01','Cash')`, [A.CompanyId, OrderId]);
  const Items = (await Plan(A.Token, OrderId, 7)).Body.Data.Installments;
  expect(Items.reduce((S: number, I: any) => S + Cents(I.Amount), 0)).toBe(9999);
});

test("r01: bad counts, second plans, paid and foreign orders are refused", async () => {
  const OrderId = await NewOrder(A.CompanyId, Customer, "100.00");
  for (const Count of [1, 13, 2.5, "3"]) expect((await Call("POST", `/Orders/${OrderId}/InstallmentPlan`, { Token: A.Token, Body: { Count } })).Status).toBe(400);
  expect((await Plan(A.Token, OrderId, 2)).Status).toBe(201);
  expect((await Plan(A.Token, OrderId, 3)).Status).toBe(409);
  const Paid = await NewOrder(A.CompanyId, Customer, "10.00", "Paid");
  expect((await Plan(A.Token, Paid, 2)).Status).toBe(409);
  const B = await NewCompany();
  expect((await Plan(B.Token, OrderId, 2)).Status).toBe(404);
});
