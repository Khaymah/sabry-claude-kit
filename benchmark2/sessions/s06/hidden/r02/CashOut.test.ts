import { beforeEach, expect, test } from "bun:test";
import { Call, CloseShift, NewCompany, NewCustomer, NewOrder, NewUser, OpenShift, Reset, TakeCash } from "../_Support";

let A: Awaited<ReturnType<typeof NewCompany>>;
let Cashier: Awaited<ReturnType<typeof NewUser>>;
let ShiftId: number;

beforeEach(async () => {
  await Reset();
  A = await NewCompany();
  Cashier = await NewUser(A.CompanyId, "Staff");
  ShiftId = (await OpenShift(Cashier.Token, "100.00")).Body.Data.Id;
});

const CashOut = (Amount: string, Token = Cashier.Token, Id = ShiftId) => Call("POST", `/Shifts/${Id}/CashOut`, { Token, Body: { Amount, Reason: "مصاريف" } });

test("r02: cash taken out of the drawer lowers the expected cash", async () => {
  const Customer = await NewCustomer(A.CompanyId);
  await TakeCash(Cashier.Token, await NewOrder(A.CompanyId, Customer, "50.00"), "50.00");
  expect((await CashOut("30.25")).Status).toBe(201);
  const Close = await CloseShift(Cashier.Token, ShiftId, "119.75");
  expect(Close.Body.Data).toMatchObject({ ExpectedCash: "119.75", Difference: "0.00" });
});

test("r02: the drawer can never go below zero, even with two cash-outs at once", async () => {
  expect((await CashOut("100.01")).Status).toBe(409);
  const Results = await Promise.all([CashOut("60.00"), CashOut("60.00"), CashOut("60.00")]);
  expect(Results.filter((R) => R.Status === 201).length).toBe(1);
  expect((await CloseShift(Cashier.Token, ShiftId, "40.00")).Body.Data.ExpectedCash).toBe("40.00");
});

test("r02: closed shifts, other cashiers and bad amounts are refused", async () => {
  const Other = await NewUser(A.CompanyId, "Staff");
  expect([403, 404]).toContain((await CashOut("1.00", Other.Token)).Status);
  for (const Bad of ["0", "-1.00", "1.001"]) expect((await CashOut(Bad)).Status).toBe(400);
  await CloseShift(Cashier.Token, ShiftId, "100.00");
  expect((await CashOut("1.00")).Status).toBe(409);
});
