import { beforeEach, expect, test } from "bun:test";
import { Call, Charge, Created, Credit, NewCompany, NewCustomer, NewOrder, OrderStatus, Reset, SetLimit, Sql } from "../_Support";

let A: Awaited<ReturnType<typeof NewCompany>>;
let Customer: number;

beforeEach(async () => {
  await Reset();
  A = await NewCompany();
  Customer = await NewCustomer(A.CompanyId);
});

test("r01: a customer without a limit has zero credit, and a charged order becomes debt", async () => {
  expect(await Credit(A.Token, Customer)).toMatchObject({ Limit: "0.00", Balance: "0.00", Available: "0.00" });
  expect(Created).toContain((await SetLimit(A.Token, Customer, "500.00")).Status);
  const OrderId = await NewOrder(A.CompanyId, Customer, "114.00");
  const Res = await Charge(A.Token, OrderId);
  expect(Created).toContain(Res.Status);
  expect(Res.Body.Data).toMatchObject({ Balance: "114.00", Available: "386.00" });
  expect(await Credit(A.Token, Customer)).toMatchObject({ Limit: "500.00", Balance: "114.00", Available: "386.00" });
  expect(await OrderStatus(OrderId)).toBe("OnCredit");
});

test("r01: only what is still unpaid on an order goes on the account", async () => {
  await SetLimit(A.Token, Customer, "1000.00");
  const OrderId = await NewOrder(A.CompanyId, Customer, "114.00");
  await Sql(`INSERT INTO "Payments" ("CompanyId","OrderId","Amount","Method") VALUES ($1,$2,'14.01','Cash')`, [A.CompanyId, OrderId]);
  expect(Created).toContain((await Charge(A.Token, OrderId)).Status);
  expect(await Credit(A.Token, Customer)).toMatchObject({ Balance: "99.99", Available: "900.01" });
});

test("r01: two credit purchases at the same moment cannot jointly pass the limit", async () => {
  await SetLimit(A.Token, Customer, "150.00");
  const First = await NewOrder(A.CompanyId, Customer, "100.00");
  const Second = await NewOrder(A.CompanyId, Customer, "100.00");
  const Results = await Promise.all([Charge(A.Token, First), Charge(A.Token, Second)]);
  expect(Results.filter((R) => Created.includes(R.Status)).length).toBe(1);
  expect(Results.filter((R) => R.Status === 409).length).toBe(1);
  expect(await Credit(A.Token, Customer)).toMatchObject({ Balance: "100.00", Available: "50.00" });
  expect([await OrderStatus(First), await OrderStatus(Second)].sort()).toEqual(["OnCredit", "Pending"]);
});

test("r01: bad limits, over-limit, non-pending and foreign orders are refused", async () => {
  for (const Limit of ["-5.00", "abc", -5, "1.234", null]) expect((await SetLimit(A.Token, Customer, Limit)).Status).toBe(400);
  await SetLimit(A.Token, Customer, "100.00");
  const Big = await NewOrder(A.CompanyId, Customer, "100.01");
  expect((await Charge(A.Token, Big)).Status).toBe(409);
  expect(await OrderStatus(Big)).toBe("Pending");
  const Paid = await NewOrder(A.CompanyId, Customer, "10.00", "Paid");
  expect((await Charge(A.Token, Paid)).Status).toBe(409);
  const OrderId = await NewOrder(A.CompanyId, Customer, "10.00");
  expect(Created).toContain((await Charge(A.Token, OrderId)).Status);
  expect((await Charge(A.Token, OrderId)).Status).toBe(409);
  const B = await NewCompany();
  const Other = await NewOrder(A.CompanyId, Customer, "10.00");
  expect((await Charge(B.Token, Other)).Status).toBe(404);
  expect((await SetLimit(B.Token, Customer, "9999.00")).Status).toBe(404);
  expect((await Call("GET", `/Customers/${Customer}/Credit`, { Token: B.Token })).Status).toBe(404);
  expect(await Credit(A.Token, Customer)).toMatchObject({ Limit: "100.00", Balance: "10.00" });
});
