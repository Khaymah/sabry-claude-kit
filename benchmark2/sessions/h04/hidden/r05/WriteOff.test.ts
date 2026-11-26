import { beforeEach, expect, test } from "bun:test";
import { Charge, Created, Credit, CreditOrder, NewCompany, NewCustomer, NewOrder, NewUser, OrderStatus, Pay, Reset, SetLimit, Statement, WriteOff } from "../_Support";

let A: Awaited<ReturnType<typeof NewCompany>>;
let Customer: number;

beforeEach(async () => {
  await Reset();
  A = await NewCompany();
  Customer = await NewCustomer(A.CompanyId);
  await SetLimit(A.Token, Customer, "500.00");
});

test("r05: writing off removes what is left of the order from the debt and shows on the statement", async () => {
  const Old = await CreditOrder(A.CompanyId, A.Token, Customer, "100.00");
  const New = await CreditOrder(A.CompanyId, A.Token, Customer, "50.00");
  await Pay(A.Token, Customer, "30.00");
  const Res = await WriteOff(A.Token, Old);
  expect(Created).toContain(Res.Status);
  expect(await OrderStatus(Old)).toBe("WrittenOff");
  expect(await Credit(A.Token, Customer)).toMatchObject({ Balance: "50.00", Available: "450.00" });
  const Entries = (await Statement(A.Token, Customer)).Body.Data.Entries;
  const Last = Entries[Entries.length - 1];
  expect(Last).toMatchObject({ Type: "WriteOff", OrderId: Old, Balance: "50.00" });
  expect(Math.abs(Number(Last.Amount))).toBe(70);
  const After = await Pay(A.Token, Customer, "50.00");
  expect(After.Body.Data.Allocations).toEqual([{ OrderId: New, Amount: "50.00" }]);
  expect(await OrderStatus(New)).toBe("Paid");
  expect((await Pay(A.Token, Customer, "0.01")).Status).toBe(409);
});

test("r05: a written-off debt frees the limit for new credit", async () => {
  await SetLimit(A.Token, Customer, "100.00");
  const First = await CreditOrder(A.CompanyId, A.Token, Customer, "100.00");
  const Next = await NewOrder(A.CompanyId, Customer, "80.00");
  expect((await Charge(A.Token, Next)).Status).toBe(409);
  expect(Created).toContain((await WriteOff(A.Token, First)).Status);
  expect(Created).toContain((await Charge(A.Token, Next)).Status);
  expect(await Credit(A.Token, Customer)).toMatchObject({ Balance: "80.00", Available: "20.00" });
});

test("r05: only the owner writes off, and only open credit orders of the same shop", async () => {
  const OrderId = await CreditOrder(A.CompanyId, A.Token, Customer, "100.00");
  const Staff = await NewUser(A.CompanyId, "Staff");
  expect((await WriteOff(Staff.Token, OrderId)).Status).toBe(403);
  const B = await NewCompany();
  expect((await WriteOff(B.Token, OrderId)).Status).toBe(404);
  expect(await OrderStatus(OrderId)).toBe("OnCredit");
  expect((await WriteOff(A.Token, await NewOrder(A.CompanyId, Customer, "10.00"))).Status).toBe(409);
  const Settled = await CreditOrder(A.CompanyId, A.Token, Customer, "20.00");
  await Pay(A.Token, Customer, "120.00");
  expect(await OrderStatus(Settled)).toBe("Paid");
  expect((await WriteOff(A.Token, Settled)).Status).toBe(409);
  const Open = await CreditOrder(A.CompanyId, A.Token, Customer, "30.00");
  expect(Created).toContain((await WriteOff(A.Token, Open)).Status);
  expect((await WriteOff(A.Token, Open)).Status).toBe(409);
  expect(await Credit(A.Token, Customer)).toMatchObject({ Balance: "0.00" });
});
