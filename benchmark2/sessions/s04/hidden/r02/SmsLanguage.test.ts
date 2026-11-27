import { afterEach, beforeEach, expect, test } from "bun:test";
import { Call, InstallSms, NewCompany, NewCustomer, NewOrder, Reset, RestoreFetch, Settle, SmsCalls, SmsSettings } from "../_Support";

let A: Awaited<ReturnType<typeof NewCompany>>;

beforeEach(async () => {
  await Reset();
  await SmsSettings();
  A = await NewCompany();
  InstallSms("ok");
});

afterEach(() => RestoreFetch());

test("r02: English-speaking customers get the receipt in English", async () => {
  const Customer = await NewCustomer(A.CompanyId, { Name: "John", Phone: "01009998888" });
  expect((await Call("PATCH", `/Customers/${Customer}`, { Token: A.Token, Body: { Language: "en" } })).Status).toBe(200);
  expect((await Call("GET", `/Customers/${Customer}`, { Token: A.Token })).Body.Data.Language).toBe("en");
  const OrderId = await NewOrder(A.CompanyId, Customer, "20.00");
  await Call("POST", "/Payments", { Token: A.Token, Body: { OrderId, Amount: "20.00", Method: "Cash" } });
  await Settle();
  expect(SmsCalls.length).toBe(1);
  expect(SmsCalls[0].Body.Text).toMatch(/order/i);
  expect(SmsCalls[0].Body.Text).toContain("20.00");
});

test("r02: everyone else keeps the Arabic receipt, and unknown languages are refused", async () => {
  const Customer = await NewCustomer(A.CompanyId, { Name: "منى", Phone: "01007776666" });
  expect((await Call("PATCH", `/Customers/${Customer}`, { Token: A.Token, Body: { Language: "fr" } })).Status).toBe(400);
  const OrderId = await NewOrder(A.CompanyId, Customer, "30.00");
  await Call("POST", "/Payments", { Token: A.Token, Body: { OrderId, Amount: "30.00", Method: "Cash" } });
  await Settle();
  expect(SmsCalls[0].Body.Text).toContain("طلب");
});
