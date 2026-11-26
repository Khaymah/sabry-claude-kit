import { beforeEach, expect, test } from "bun:test";
import {
  AddExpense, AddUser, Branches, Call, Huge, List, MainBranch, NewBranch, NewMember, OrderIds,
  OrderStatus, PlaceOrder, Sql, UserCountByEmail, UserRow, World, type Shop,
} from "../_Support";

let A: Shop;
let B: Shop;

beforeEach(async () => {
  ({ A, B } = await World());
});

test("r01: everything that existed before branches lands in the main branch and keeps working", async () => {
  const All = await Branches(A.Owner.Token);
  expect(All.length).toBe(1);
  const Main = await MainBranch(A.Owner.Token);
  expect((await UserRow(A.Owner.Token, A.Staff.UserId)).BranchId).toBe(Main);
  const Legacy = await Call("GET", `/Orders/${A.LegacyOrderId}`, { Token: A.Staff.Token });
  expect(Legacy.Status).toBe(200);
  expect(Legacy.Body.Data.BranchId).toBe(Main);
  expect(await OrderIds(A.Staff.Token)).toContain(A.LegacyOrderId);
  const Expenses = await Call("GET", "/Expenses?Month=2026-03", { Token: A.Staff.Token });
  expect(List(Expenses.Body).find((E: any) => E.Id === A.LegacyExpenseId)?.BranchId).toBe(Main);
  const Fresh = await PlaceOrder(A.Staff.Token, A);
  expect(Fresh.Status).toBe(201);
  expect(Fresh.Body.Data.BranchId).toBe(Main);
  const OwnerOrder = await PlaceOrder(A.Owner.Token, A);
  expect(OwnerOrder.Body.Data.BranchId).toBe(Main);
});

test("r01: a branch staff member only sees and changes their own branch's orders and expenses", async () => {
  const Nasr = await NewBranch(A.Owner.Token, "Nasr City");
  const Staff = await NewMember(A.Owner.Token, "Staff", Nasr);
  expect((await UserRow(A.Owner.Token, Staff.UserId)).BranchId).toBe(Nasr);
  const Mine = await PlaceOrder(Staff.Token, A);
  expect(Mine.Status).toBe(201);
  expect(Mine.Body.Data.BranchId).toBe(Nasr);
  const MyExpense = await AddExpense(Staff.Token, "25.00", "2026-03-12");
  expect(MyExpense.Body.Data.BranchId).toBe(Nasr);

  expect(await OrderIds(Staff.Token)).toEqual([Mine.Body.Data.Id]);
  expect([403, 404]).toContain((await Call("GET", `/Orders/${A.LegacyOrderId}`, { Token: Staff.Token })).Status);
  expect([403, 404]).toContain((await Call("POST", `/Orders/${A.LegacyOrderId}/Cancel`, { Token: Staff.Token })).Status);
  expect(await OrderStatus(A.LegacyOrderId)).toBe("Pending");

  const Listed = List((await Call("GET", "/Expenses?Month=2026-03", { Token: Staff.Token })).Body).map((E: any) => E.Id);
  expect(Listed).toEqual([MyExpense.Body.Data.Id]);
  const Totals = List((await Call("GET", "/Expenses/Totals?Month=2026-03", { Token: Staff.Token })).Body);
  expect(Totals.map((T: any) => [T.Category, T.Total])).toEqual([["Supplies", "25.00"]]);
  expect([403, 404]).toContain((await Call("DELETE", `/Expenses/${A.LegacyExpenseId}`, { Token: Staff.Token })).Status);
  const [Left] = await Sql<{ N: number }>(`SELECT count(*)::int AS "N" FROM "Expenses" WHERE "Id" = $1`, [A.LegacyExpenseId]);
  expect(Left.N).toBe(1);

  const OwnerSees = await OrderIds(A.Owner.Token);
  expect(OwnerSees).toContain(A.LegacyOrderId);
  expect(OwnerSees).toContain(Mine.Body.Data.Id);
});

test("r01: a staff member cannot work on another branch or create branches", async () => {
  const Main = await MainBranch(A.Owner.Token);
  const Nasr = await NewBranch(A.Owner.Token, "Nasr City");
  const Staff = await NewMember(A.Owner.Token, "Staff", Nasr);
  expect((await Call("POST", "/Branches", { Token: Staff.Token, Body: { Name: "Mine" } })).Status).toBe(403);
  expect((await Branches(A.Owner.Token)).length).toBe(2);

  const Sneaky = await PlaceOrder(Staff.Token, A, Main);
  if (Sneaky.Status === 201) expect(Sneaky.Body.Data.BranchId).toBe(Nasr);
  else expect([400, 403, 404]).toContain(Sneaky.Status);
  const SneakyExpense = await AddExpense(Staff.Token, "10.00", "2026-03-12", Main);
  if (SneakyExpense.Status === 201) expect(SneakyExpense.Body.Data.BranchId).toBe(Nasr);
  else expect([400, 403, 404]).toContain(SneakyExpense.Status);

  const MainOrders = List((await Call("GET", "/Orders?Page=1&PageSize=100", { Token: A.Owner.Token })).Body).filter((O: any) => O.BranchId === Main);
  expect(MainOrders.map((O: any) => O.Id)).toEqual([A.LegacyOrderId]);
  const MainExpenses = List((await Call("GET", "/Expenses?Month=2026-03", { Token: A.Owner.Token })).Body).filter((E: any) => E.BranchId === Main);
  expect(MainExpenses.map((E: any) => E.Id)).toEqual([A.LegacyExpenseId]);
});

test("r01: branches never cross companies and bad branch ids are rejected cleanly", async () => {
  const BMain = await MainBranch(B.Owner.Token);
  await NewBranch(A.Owner.Token, "Heliopolis");
  const BNames = (await Branches(B.Owner.Token)).map((X: any) => X.Name);
  expect(BNames).not.toContain("Heliopolis");
  expect(BNames.length).toBe(1);

  for (const BranchId of [BMain, Huge]) {
    const { Email, Res } = await AddUser(A.Owner.Token, "Staff", BranchId);
    expect([400, 404]).toContain(Res.Status);
    expect(await UserCountByEmail(Email)).toBe(0);
    expect([400, 404]).toContain((await PlaceOrder(A.Owner.Token, A, BranchId)).Status);
    expect([400, 404]).toContain((await AddExpense(A.Owner.Token, "5.00", "2026-03-12", BranchId)).Status);
  }
  expect((await Call("POST", "/Branches", { Token: A.Owner.Token, Body: { Name: "" } })).Status).toBe(400);
  const [Count] = await Sql<{ N: number }>(`SELECT count(*)::int AS "N" FROM "Orders" WHERE "CompanyId" = $1`, [A.CompanyId]);
  expect(Count.N).toBe(1);
});
