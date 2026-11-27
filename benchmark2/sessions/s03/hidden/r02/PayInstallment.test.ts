import { beforeEach, expect, test } from "bun:test";
import { Call, NewCompany, NewCustomer, NewOrder, OrderStatus, Plan, Reset, Sql } from "../_Support";

let A: Awaited<ReturnType<typeof NewCompany>>;
let OrderId: number;

beforeEach(async () => {
  await Reset();
  A = await NewCompany();
  const Customer = await NewCustomer(A.CompanyId);
  OrderId = await NewOrder(A.CompanyId, Customer, "100.00");
  expect((await Plan(A.Token, OrderId, 3)).Status).toBe(201);
});

const PayNo = (No: number, Token = A.Token) => Call("POST", `/Orders/${OrderId}/Installments/${No}/Pay`, { Token, Body: { Method: "Cash" } });
const PaymentsSum = async () => (await Sql<{ S: string }>(`SELECT coalesce(sum("Amount"),0)::numeric(12,2)::text AS "S" FROM "Payments" WHERE "OrderId" = $1`, [OrderId]))[0].S;

test("r02: paying an installment records a payment of its amount", async () => {
  const Plan_ = (await Call("GET", `/Orders/${OrderId}/InstallmentPlan`, { Token: A.Token })).Body.Data.Installments;
  expect((await PayNo(2)).Status).toBe(201);
  expect(await PaymentsSum()).toBe(Plan_[1].Amount);
  const After = (await Call("GET", `/Orders/${OrderId}/InstallmentPlan`, { Token: A.Token })).Body.Data.Installments;
  expect(After.map((I: any) => I.Status)).toEqual(["Due", "Paid", "Due"]);
  expect(await OrderStatus(OrderId)).toBe("Pending");
});

test("r02: paying every installment pays the order", async () => {
  for (const No of [1, 2, 3]) expect((await PayNo(No)).Status).toBe(201);
  expect(await PaymentsSum()).toBe("100.00");
  expect(await OrderStatus(OrderId)).toBe("Paid");
  expect((await PayNo(1)).Status).toBe(409);
});

test("r02: a double click pays an installment once", async () => {
  const Results = await Promise.all([PayNo(1), PayNo(1), PayNo(1)]);
  expect(Results.filter((R) => R.Status === 201).length).toBe(1);
  const [C] = await Sql<{ N: number }>(`SELECT count(*)::int AS "N" FROM "Payments" WHERE "OrderId" = $1`, [OrderId]);
  expect(C.N).toBe(1);
});

test("r02: unknown installments and other shops are refused", async () => {
  expect((await PayNo(4)).Status).toBe(404);
  const B = await NewCompany();
  expect((await PayNo(1, B.Token)).Status).toBe(404);
  expect(await PaymentsSum()).toBe("0.00");
});
