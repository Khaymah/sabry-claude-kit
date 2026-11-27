import { afterEach, beforeEach, expect, test } from "bun:test";
import { Call, InstallSms, NewCompany, NewCustomer, NewOrder, Reset, RestoreFetch, SetSmsMode, SmsCalls, SmsSettings } from "../_Support";

let A: Awaited<ReturnType<typeof NewCompany>>;
let Customer: number;

beforeEach(async () => {
  await Reset();
  await SmsSettings();
  A = await NewCompany();
  Customer = await NewCustomer(A.CompanyId, { Phone: "01003334444" });
  InstallSms("ok");
});

afterEach(() => RestoreFetch());

const Resend = (Id: number, Token = A.Token) => Call("POST", `/Orders/${Id}/ResendReceipt`, { Token });

test("r03: the receipt of a paid order can be sent again", async () => {
  const OrderId = await NewOrder(A.CompanyId, Customer, "40.00", "Paid");
  const Res = await Resend(OrderId);
  expect(Res.Status).toBe(200);
  expect(SmsCalls.length).toBe(1);
  expect(SmsCalls[0].Body.Text).toContain("40.00");
  expect((await Resend(OrderId)).Status).toBe(200);
  expect(SmsCalls.length).toBe(2);
});

test("r03: unpaid or foreign orders get no receipt, and provider failure is reported", async () => {
  const Pending = await NewOrder(A.CompanyId, Customer, "40.00");
  expect((await Resend(Pending)).Status).toBe(409);
  const B = await NewCompany();
  const Paid = await NewOrder(A.CompanyId, Customer, "40.00", "Paid");
  expect((await Resend(Paid, B.Token)).Status).toBe(404);
  expect(SmsCalls.length).toBe(0);
  SetSmsMode("fail");
  const Failed = await Resend(Paid);
  expect(Failed.Status).toBe(502);
});
