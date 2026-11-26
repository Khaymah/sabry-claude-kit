import { beforeEach, expect, test } from "bun:test";
import { CloseShift, NewCompany, NewCustomer, NewOrder, NewUser, OpenShift, Reset, TakeCash } from "../_Support";

let A: Awaited<ReturnType<typeof NewCompany>>;
let Cashier: Awaited<ReturnType<typeof NewUser>>;
let Customer: number;

beforeEach(async () => {
  await Reset();
  A = await NewCompany();
  Cashier = await NewUser(A.CompanyId, "Staff");
  Customer = await NewCustomer(A.CompanyId);
});

test("r01: closing a shift compares the counted cash with the cash this cashier took", async () => {
  const Open = await OpenShift(Cashier.Token, "500.00");
  expect(Open.Status).toBe(201);
  const Other = await NewUser(A.CompanyId, "Staff");
  await TakeCash(Cashier.Token, await NewOrder(A.CompanyId, Customer, "114.00"), "114.00");
  await TakeCash(Cashier.Token, await NewOrder(A.CompanyId, Customer, "50.00"), "20.50");
  await TakeCash(Cashier.Token, await NewOrder(A.CompanyId, Customer, "80.00"), "80.00", "Card");
  await TakeCash(Other.Token, await NewOrder(A.CompanyId, Customer, "70.00"), "70.00");
  const Close = await CloseShift(Cashier.Token, Open.Body.Data.Id, "630.00");
  expect(Close.Status).toBe(200);
  expect(Close.Body.Data).toMatchObject({ ExpectedCash: "634.50", CountedCash: "630.00", Difference: "-4.50" });
});

test("r01: a cashier has one open shift at a time, even on a double tap", async () => {
  const Results = await Promise.all([OpenShift(Cashier.Token), OpenShift(Cashier.Token), OpenShift(Cashier.Token)]);
  expect(Results.filter((R) => R.Status === 201).length).toBe(1);
  expect(Results.filter((R) => R.Status === 409).length).toBe(2);
  const Id = Results.find((R) => R.Status === 201)!.Body.Data.Id;
  expect((await CloseShift(Cashier.Token, Id, "500.00")).Status).toBe(200);
  expect((await CloseShift(Cashier.Token, Id, "500.00")).Status).toBe(409);
  expect((await OpenShift(Cashier.Token)).Status).toBe(201);
});

test("r01: cash taken before the shift opened or after it closed is not counted", async () => {
  await TakeCash(Cashier.Token, await NewOrder(A.CompanyId, Customer, "10.00"), "10.00");
  const Open = await OpenShift(Cashier.Token, "100.00");
  await TakeCash(Cashier.Token, await NewOrder(A.CompanyId, Customer, "25.00"), "25.00");
  const Close = await CloseShift(Cashier.Token, Open.Body.Data.Id, "125.00");
  expect(Close.Body.Data).toMatchObject({ ExpectedCash: "125.00", Difference: "0.00" });
  await TakeCash(Cashier.Token, await NewOrder(A.CompanyId, Customer, "5.00"), "5.00");
  const Next = await OpenShift(Cashier.Token, "0.00");
  expect((await CloseShift(Cashier.Token, Next.Body.Data.Id, "0.00")).Body.Data.ExpectedCash).toBe("0.00");
});

test("r01: another cashier cannot close my shift", async () => {
  const Open = await OpenShift(Cashier.Token);
  const Other = await NewUser(A.CompanyId, "Staff");
  expect([403, 404]).toContain((await CloseShift(Other.Token, Open.Body.Data.Id, "0.00")).Status);
});
