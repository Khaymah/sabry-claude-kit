import { beforeEach, expect, test } from "bun:test";
import { Call, Created, Credit, CreditOrder, NewCompany, NewCustomer, OrderStatus, PaidOnOrder, Pay, Reset, SetLimit, Sql } from "../_Support";

let A: Awaited<ReturnType<typeof NewCompany>>;
let Customer: number;

beforeEach(async () => {
  await Reset();
  A = await NewCompany();
  Customer = await NewCustomer(A.CompanyId);
  await SetLimit(A.Token, Customer, "1000.00");
});

test("r02: a repayment settles the oldest credit order first and records payments on the orders", async () => {
  const Old = await CreditOrder(A.CompanyId, A.Token, Customer, "100.00");
  const New = await CreditOrder(A.CompanyId, A.Token, Customer, "50.00");
  const Res = await Pay(A.Token, Customer, "120.00");
  expect(Created).toContain(Res.Status);
  expect(Res.Body.Data.Allocations).toEqual([
    { OrderId: Old, Amount: "100.00" },
    { OrderId: New, Amount: "20.00" },
  ]);
  expect(Res.Body.Data.Balance).toBe("30.00");
  expect(await PaidOnOrder(Old)).toBe("100.00");
  expect(await PaidOnOrder(New)).toBe("20.00");
  expect(await OrderStatus(Old)).toBe("Paid");
  expect(await OrderStatus(New)).toBe("OnCredit");
  expect(await Credit(A.Token, Customer)).toMatchObject({ Balance: "30.00", Available: "970.00" });
});

test("r02: the same request sent several times at once is applied once", async () => {
  await CreditOrder(A.CompanyId, A.Token, Customer, "100.00");
  const Results = await Promise.all([1, 2, 3].map(() => Pay(A.Token, Customer, "40.00", "same-click")));
  for (const R of Results) expect(R.Status).toBeLessThan(500);
  expect(Results.some((R) => Created.includes(R.Status))).toBe(true);
  const Again = await Pay(A.Token, Customer, "40.00", "same-click");
  expect(Again.Status).toBeLessThan(500);
  expect(await Credit(A.Token, Customer)).toMatchObject({ Balance: "60.00" });
  const [Row] = await Sql<{ S: string }>(`SELECT coalesce(sum("Amount"),0)::numeric(12,2)::text AS "S" FROM "Payments" WHERE "CompanyId" = $1`, [A.CompanyId]);
  expect(Row.S).toBe("40.00");
});

test("r02: parallel repayments cannot pay more than the debt", async () => {
  await CreditOrder(A.CompanyId, A.Token, Customer, "100.00");
  const Results = await Promise.all([Pay(A.Token, Customer, "60.00"), Pay(A.Token, Customer, "60.00")]);
  expect(Results.filter((R) => Created.includes(R.Status)).length).toBe(1);
  expect(Results.filter((R) => R.Status === 409).length).toBe(1);
  expect(await Credit(A.Token, Customer)).toMatchObject({ Balance: "40.00" });
});

test("r02: bad amounts, overpayment and other shops are refused", async () => {
  const OrderId = await CreditOrder(A.CompanyId, A.Token, Customer, "100.00");
  for (const Amount of ["0", "0.00", "-5.00", "abc", "1.234"]) expect((await Pay(A.Token, Customer, Amount)).Status).toBe(400);
  expect((await Call("POST", `/Customers/${Customer}/CreditPayments`, { Token: A.Token, Body: { Amount: "5.00", Method: "Cash" } })).Status).toBe(400);
  expect((await Pay(A.Token, Customer, "5.00", undefined, "Bitcoin")).Status).toBe(400);
  expect((await Pay(A.Token, Customer, "100.01")).Status).toBe(409);
  const B = await NewCompany();
  expect((await Pay(B.Token, Customer, "10.00")).Status).toBe(404);
  expect(await PaidOnOrder(OrderId)).toBe("0.00");
  expect(await Credit(A.Token, Customer)).toMatchObject({ Balance: "100.00" });
});
