import { afterEach, beforeEach, expect, test } from "bun:test";
import { Call, InstallSms, NewCompany, NewCustomer, NewOrder, Reset, RestoreFetch, Settle, SmsCalls, SmsSettings, Sql } from "../_Support";

let A: Awaited<ReturnType<typeof NewCompany>>;
let Customer: number;

beforeEach(async () => {
  await Reset();
  await SmsSettings();
  A = await NewCompany();
  Customer = await NewCustomer(A.CompanyId, { Name: "هبة", Phone: "01001112222" });
});

afterEach(() => RestoreFetch());

const Pay = (OrderId: number, Amount: string) => Call("POST", "/Payments", { Token: A.Token, Body: { OrderId, Amount, Method: "Cash" } });

test("r01: the customer gets one SMS when the order is fully paid", async () => {
  InstallSms("ok");
  const OrderId = await NewOrder(A.CompanyId, Customer, "114.00");
  expect((await Pay(OrderId, "14.00")).Status).toBe(201);
  await Settle();
  expect(SmsCalls.length).toBe(0);
  expect((await Pay(OrderId, "100.00")).Status).toBe(201);
  await Settle();
  expect(SmsCalls.length).toBe(1);
  expect(SmsCalls[0].Body.To).toBe("01001112222");
  expect(SmsCalls[0].Body.Text).toContain("114.00");
});

test("r01: a failing SMS provider never blocks the payment", async () => {
  InstallSms("fail");
  const OrderId = await NewOrder(A.CompanyId, Customer, "50.00");
  const Res = await Pay(OrderId, "50.00");
  expect(Res.Status).toBe(201);
  const [O] = await Sql<{ Status: string }>(`SELECT "Status" FROM "Orders" WHERE "Id" = $1`, [OrderId]);
  expect(O.Status).toBe("Paid");
});

test("r01: a hanging SMS provider does not hold the cashier", async () => {
  InstallSms("hang");
  const OrderId = await NewOrder(A.CompanyId, Customer, "50.00");
  const Started = performance.now();
  const Res = await Pay(OrderId, "50.00");
  expect(performance.now() - Started).toBeLessThan(1500);
  expect(Res.Status).toBe(201);
  const Other = await NewOrder(A.CompanyId, Customer, "5.00");
  const Started2 = performance.now();
  expect((await Pay(Other, "5.00")).Status).toBe(201);
  expect(performance.now() - Started2).toBeLessThan(1500);
  await Settle();
  const [C] = await Sql<{ N: number }>(`SELECT count(*)::int AS "N" FROM "Payments"`);
  expect(C.N).toBe(2);
});

test("r01: customers without a phone are simply skipped", async () => {
  InstallSms("ok");
  const NoPhone = await NewCustomer(A.CompanyId, { Name: "بدون" });
  const OrderId = await NewOrder(A.CompanyId, NoPhone, "10.00");
  expect((await Pay(OrderId, "10.00")).Status).toBe(201);
  await Settle();
  expect(SmsCalls.length).toBe(0);
});
