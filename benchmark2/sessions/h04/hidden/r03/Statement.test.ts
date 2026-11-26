import { afterEach, beforeEach, expect, test } from "bun:test";
import { At, Call, Cents, CreditOrder, NewCompany, NewCustomer, OrderStatus, PaidOnOrder, Pay, RealTime, Reset, SetLimit, Statement } from "../_Support";

let A: Awaited<ReturnType<typeof NewCompany>>;
let Customer: number;

beforeEach(async () => {
  await Reset();
  A = await NewCompany();
  Customer = await NewCustomer(A.CompanyId);
  await SetLimit(A.Token, Customer, "1000.00");
});

afterEach(() => RealTime());

test("r03: the statement lists purchases and payments oldest first with the balance after each", async () => {
  const Empty = await Statement(A.Token, Customer);
  expect(Empty.Status).toBe(200);
  expect(Empty.Body.Data).toMatchObject({ CustomerId: Customer, Limit: "1000.00", Balance: "0.00", Entries: [] });
  At("2031-02-01T10:00:00Z");
  const First = await CreditOrder(A.CompanyId, A.Token, Customer, "100.00");
  At("2031-02-02T10:00:00Z");
  const Second = await CreditOrder(A.CompanyId, A.Token, Customer, "33.33");
  At("2031-02-03T10:00:00Z");
  await Pay(A.Token, Customer, "120.00");
  At("2031-02-04T10:00:00Z");
  const Third = await CreditOrder(A.CompanyId, A.Token, Customer, "10.01");
  const Res = await Statement(A.Token, Customer);
  expect(Res.Status).toBe(200);
  const Entries = Res.Body.Data.Entries;
  expect(Entries.map((E: any) => E.Type)).toEqual(["Purchase", "Purchase", "Payment", "Purchase"]);
  expect(Entries.map((E: any) => E.OrderId)).toEqual([First, Second, null, Third]);
  expect(Entries.map((E: any) => Math.abs(Cents(E.Amount)))).toEqual([10000, 3333, 12000, 1001]);
  expect(Entries.map((E: any) => E.Balance)).toEqual(["100.00", "133.33", "13.33", "23.34"]);
  expect(Res.Body.Data.Balance).toBe("23.34");
  const Times = Entries.map((E: any) => new Date(E.At).getTime());
  expect([...Times].sort((X: number, Y: number) => X - Y)).toEqual(Times);
});

test("r03: after the correction a repayment clears the oldest order before newer ones", async () => {
  At("2031-03-01T10:00:00Z");
  const Oldest = await CreditOrder(A.CompanyId, A.Token, Customer, "40.00");
  At("2031-03-05T10:00:00Z");
  const Middle = await CreditOrder(A.CompanyId, A.Token, Customer, "60.00");
  At("2031-03-09T10:00:00Z");
  const Newest = await CreditOrder(A.CompanyId, A.Token, Customer, "80.00");
  At("2031-03-10T10:00:00Z");
  const Res = await Pay(A.Token, Customer, "70.00");
  expect(Res.Body.Data.Allocations).toEqual([
    { OrderId: Oldest, Amount: "40.00" },
    { OrderId: Middle, Amount: "30.00" },
  ]);
  expect(await OrderStatus(Oldest)).toBe("Paid");
  expect(await PaidOnOrder(Middle)).toBe("30.00");
  expect(await PaidOnOrder(Newest)).toBe("0.00");
  const Next = await Pay(A.Token, Customer, "50.00");
  expect(Next.Body.Data.Allocations).toEqual([
    { OrderId: Middle, Amount: "30.00" },
    { OrderId: Newest, Amount: "20.00" },
  ]);
});

test("r03: another shop, unknown and out-of-range customers get no statement", async () => {
  await CreditOrder(A.CompanyId, A.Token, Customer, "50.00");
  const B = await NewCompany();
  const Foreign = await Statement(B.Token, Customer);
  expect(Foreign.Status).toBe(404);
  expect(Foreign.Text).not.toContain("50.00");
  expect((await Statement(A.Token, 999999)).Status).toBe(404);
  for (const Id of ["99999999999", "abc", "-1"]) expect([400, 404]).toContain((await Call("GET", `/Customers/${Id}/CreditStatement`, { Token: A.Token })).Status);
});
