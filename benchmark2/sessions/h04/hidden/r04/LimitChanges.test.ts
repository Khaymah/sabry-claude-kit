import { beforeEach, expect, test } from "bun:test";
import { Call, Charge, Created, Credit, CreditOrder, NewCompany, NewCustomer, NewOrder, NewUser, Pay, Reset, SetLimit } from "../_Support";

let A: Awaited<ReturnType<typeof NewCompany>>;
let Customer: number;

beforeEach(async () => {
  await Reset();
  A = await NewCompany();
  Customer = await NewCustomer(A.CompanyId);
});

const Changes = (Token: string, Id = Customer) => Call("GET", `/Customers/${Id}/CreditLimitChanges`, { Token });

test("r04: only the owner changes limits and every change is recorded newest first", async () => {
  const Staff = await NewUser(A.CompanyId, "Staff");
  expect((await SetLimit(Staff.Token, Customer, "900.00")).Status).toBe(403);
  expect(await Credit(A.Token, Customer)).toMatchObject({ Limit: "0.00" });
  expect(Created).toContain((await SetLimit(A.Token, Customer, "300.00")).Status);
  expect(Created).toContain((await SetLimit(A.Token, Customer, "250.50")).Status);
  const Res = await Changes(Staff.Token);
  expect(Res.Status).toBe(200);
  const Rows = Array.isArray(Res.Body.Data) ? Res.Body.Data : Res.Body.Data.Items;
  expect(Rows.length).toBe(2);
  expect(Rows[0]).toMatchObject({ OldLimit: "300.00", NewLimit: "250.50", ChangedByUserId: A.UserId });
  expect(Rows[1]).toMatchObject({ OldLimit: "0.00", NewLimit: "300.00", ChangedByUserId: A.UserId });
  expect(Number.isNaN(new Date(Rows[0].ChangedAt).getTime())).toBe(false);
});

test("r04: a limit lowered below the debt blocks new credit until the debt drops", async () => {
  await SetLimit(A.Token, Customer, "200.00");
  await CreditOrder(A.CompanyId, A.Token, Customer, "150.00");
  expect(Created).toContain((await SetLimit(A.Token, Customer, "100.00")).Status);
  expect(await Credit(A.Token, Customer)).toMatchObject({ Limit: "100.00", Balance: "150.00", Available: "0.00" });
  const Small = await NewOrder(A.CompanyId, Customer, "1.00");
  expect((await Charge(A.Token, Small)).Status).toBe(409);
  expect(Created).toContain((await Pay(A.Token, Customer, "60.00")).Status);
  expect(await Credit(A.Token, Customer)).toMatchObject({ Balance: "90.00", Available: "10.00" });
  expect((await Charge(A.Token, await NewOrder(A.CompanyId, Customer, "10.01"))).Status).toBe(409);
  expect(Created).toContain((await Charge(A.Token, await NewOrder(A.CompanyId, Customer, "10.00"))).Status);
  expect(await Credit(A.Token, Customer)).toMatchObject({ Balance: "100.00", Available: "0.00" });
});

test("r04: another shop cannot read or change a customer's limit history", async () => {
  await SetLimit(A.Token, Customer, "300.00");
  const B = await NewCompany();
  expect((await Changes(B.Token)).Status).toBe(404);
  expect((await SetLimit(B.Token, Customer, "5000.00")).Status).toBe(404);
  const Own = await NewCustomer(B.CompanyId);
  await SetLimit(B.Token, Own, "10.00");
  const Rows = (await Changes(A.Token)).Body.Data;
  expect((Array.isArray(Rows) ? Rows : Rows.Items).length).toBe(1);
  expect(await Credit(A.Token, Customer)).toMatchObject({ Limit: "300.00" });
});
