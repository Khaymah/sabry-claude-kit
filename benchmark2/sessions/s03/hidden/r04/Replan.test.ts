import { beforeEach, expect, test } from "bun:test";
import { Call, Cents, NewCompany, NewCustomer, NewOrder, OrderStatus, Plan, Reset } from "../_Support";

let A: Awaited<ReturnType<typeof NewCompany>>;
let OrderId: number;

beforeEach(async () => {
  await Reset();
  A = await NewCompany();
  OrderId = await NewOrder(A.CompanyId, await NewCustomer(A.CompanyId), "100.00");
  await Plan(A.Token, OrderId, 4);
});

const Replan = (Count: unknown) => Call("PUT", `/Orders/${OrderId}/InstallmentPlan`, { Token: A.Token, Body: { Count } });
const Read = async () => (await Call("GET", `/Orders/${OrderId}/InstallmentPlan`, { Token: A.Token })).Body.Data.Installments;

test("r04: the unpaid rest is re-split and paid installments stay as they were", async () => {
  expect((await Call("POST", `/Orders/${OrderId}/Installments/1/Pay`, { Token: A.Token, Body: { Method: "Cash" } })).Status).toBe(201);
  const Res = await Replan(3);
  expect(Res.Status).toBe(200);
  const Items = await Read();
  const Paid = Items.filter((I: any) => I.Status === "Paid");
  const Due = Items.filter((I: any) => I.Status === "Due");
  expect(Paid.map((I: any) => I.Amount)).toEqual(["25.00"]);
  expect(Due.length).toBe(3);
  expect(Due.reduce((S: number, I: any) => S + Cents(I.Amount), 0)).toBe(7500);
  expect(new Set(Items.map((I: any) => I.No)).size).toBe(Items.length);
  for (const I of Due) expect((await Call("POST", `/Orders/${OrderId}/Installments/${I.No}/Pay`, { Token: A.Token, Body: { Method: "Cash" } })).Status).toBe(201);
  expect(await OrderStatus(OrderId)).toBe("Paid");
});

test("r04: replanning a fully paid plan or with a bad count is refused", async () => {
  expect((await Replan(0)).Status).toBe(400);
  for (const I of await Read()) await Call("POST", `/Orders/${OrderId}/Installments/${I.No}/Pay`, { Token: A.Token, Body: { Method: "Cash" } });
  expect((await Replan(2)).Status).toBe(409);
});
