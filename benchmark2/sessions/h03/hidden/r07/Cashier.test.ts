import { beforeEach, expect, test } from "bun:test";
import {
  AddExpense, AddUser, AuditItems, Call, Huge, List, MainBranch, NewBranch, NewExpense, NewMember, NewOrder, OrderStatus, Sql,
  UserCountByEmail, UserRow, Users, World, type Shop,
} from "../_Support";

let A: Shop;
let B: Shop;
let Nasr: number;
let Maadi: number;
let Manager: Awaited<ReturnType<typeof NewMember>>;
let Cashier: Awaited<ReturnType<typeof NewMember>>;

beforeEach(async () => {
  ({ A, B } = await World());
  Nasr = await NewBranch(A.Owner.Token, "Nasr City");
  Maadi = await NewBranch(A.Owner.Token, "Maadi");
  Manager = await NewMember(A.Owner.Token, "BranchManager", Nasr);
  Cashier = await NewMember(Manager.Token, "Cashier");
});

const Pay = (Token: string, OrderId: number | string, Method = "Cash") => Call("POST", `/Orders/${OrderId}/Pay`, { Token, Body: { Method } });
const Payments = async (OrderId: number) =>
  (await Sql<{ N: number; S: string }>(`SELECT count(*)::int AS "N", coalesce(sum("Amount"),0)::numeric(12,2)::text AS "S" FROM "Payments" WHERE "OrderId" = $1`, [OrderId]))[0];

test("r07: a cashier sells and collects the remaining amount, and cannot cancel or touch expenses", async () => {
  expect((await UserRow(A.Owner.Token, Cashier.UserId)).BranchId).toBe(Nasr);
  const Order = await NewOrder(Cashier.Token, A, undefined, 2);
  expect((await Call("GET", `/Orders/${Order}`, { Token: A.Owner.Token })).Body.Data.BranchId).toBe(Nasr);
  expect((await Call("POST", "/Payments", { Token: A.Owner.Token, Body: { OrderId: Order, Amount: "28.00", Method: "Card" } })).Status).toBe(201);
  expect([200, 201]).toContain((await Pay(Cashier.Token, Order, "Wallet")).Status);
  expect(await OrderStatus(Order)).toBe("Paid");
  expect(await Payments(Order)).toEqual({ N: 2, S: "228.00" });
  expect((await Pay(Cashier.Token, Order)).Status).toBe(409);
  expect(await Payments(Order)).toEqual({ N: 2, S: "228.00" });
  const Logged = (await AuditItems(A.Owner.Token)).filter((I: any) => I.Action === "Order.Pay" && I.EntityId === Order);
  expect(Logged.length).toBe(1);
  expect(Logged[0].UserId).toBe(Cashier.UserId);

  const Other = await NewOrder(Cashier.Token, A);
  expect((await Call("POST", `/Orders/${Other}/Cancel`, { Token: Cashier.Token })).Status).toBe(403);
  expect(await OrderStatus(Other)).toBe("Pending");
  expect((await AddExpense(Cashier.Token, "10.00", "2026-03-12")).Status).toBe(403);
  const Expense = await NewExpense(Manager.Token, "10.00", "2026-03-12");
  expect([403, 404]).toContain((await Call("DELETE", `/Expenses/${Expense}`, { Token: Cashier.Token })).Status);
  const [Left] = await Sql<{ N: number }>(`SELECT count(*)::int AS "N" FROM "Expenses" WHERE "Id" = $1`, [Expense]);
  expect(Left.N).toBe(1);
});

test("r07: a cashier and staff only see and collect their own branch's orders", async () => {
  const Mine = await NewOrder(Cashier.Token, A);
  const MaadiOrder = await NewOrder(A.Owner.Token, A, Maadi);
  const Listed = await Call("GET", "/Orders?Page=1&PageSize=100", { Token: Cashier.Token });
  if (Listed.Status === 200) expect(List(Listed.Body).map((O: any) => O.Id)).toEqual([Mine]);
  else expect(Listed.Status).toBe(403);
  expect([403, 404]).toContain((await Call("GET", `/Orders/${MaadiOrder}`, { Token: Cashier.Token })).Status);
  for (const Target of [MaadiOrder, A.LegacyOrderId]) {
    expect([403, 404]).toContain((await Pay(Cashier.Token, Target)).Status);
    expect(await OrderStatus(Target)).toBe("Pending");
    expect((await Payments(Target)).N).toBe(0);
  }
  const Staff = await NewMember(Manager.Token, "Staff");
  expect([403, 404]).toContain((await Pay(Staff.Token, MaadiOrder)).Status);
  expect([403, 404]).toContain((await Pay(Manager.Token, A.LegacyOrderId)).Status);
  expect((await Payments(MaadiOrder)).N).toBe(0);
  expect((await Payments(A.LegacyOrderId)).N).toBe(0);
  const Seen = await Call("GET", "/Users", { Token: Cashier.Token });
  if (Seen.Status === 200) expect(List(Seen.Body).every((U: any) => U.BranchId === Nasr)).toBe(true);
  else expect(Seen.Status).toBe(403);
});

test("r07: a double click on pay charges once", async () => {
  const Order = await NewOrder(Cashier.Token, A);
  const Results = await Promise.all([Pay(Cashier.Token, Order), Pay(Cashier.Token, Order), Pay(Manager.Token, Order)]);
  expect(Results.filter((R) => R.Status === 200 || R.Status === 201).length).toBe(1);
  for (const R of Results) expect([200, 201, 409]).toContain(R.Status);
  expect(await Payments(Order)).toEqual({ N: 1, S: "114.00" });
  expect(await OrderStatus(Order)).toBe("Paid");
});

test("r07: cashiers cannot add people and payment input is checked", async () => {
  const Main = await MainBranch(A.Owner.Token);
  const { Email, Res } = await AddUser(Cashier.Token, "Cashier");
  expect(Res.Status).toBe(403);
  expect(await UserCountByEmail(Email)).toBe(0);
  const Elsewhere = await AddUser(Manager.Token, "Cashier", Maadi);
  if (Elsewhere.Res.Status === 201) expect((await UserRow(A.Owner.Token, Elsewhere.Res.Body.Data.Id)).BranchId).toBe(Nasr);
  else expect([400, 403, 404]).toContain(Elsewhere.Res.Status);
  expect((await Users(A.Owner.Token)).filter((U: any) => U.BranchId === Maadi || (U.BranchId === Main && U.Role === "Cashier")).length).toBe(0);

  const Order = await NewOrder(Cashier.Token, A);
  expect((await Pay(Cashier.Token, Order, "Bitcoin")).Status).toBe(400);
  expect([400, 404]).toContain((await Pay(Cashier.Token, Huge)).Status);
  expect((await Pay(B.Owner.Token, Order)).Status).toBe(404);
  const Cancelled = await NewOrder(Manager.Token, A);
  expect((await Call("POST", `/Orders/${Cancelled}/Cancel`, { Token: Manager.Token })).Status).toBe(200);
  expect((await Pay(Manager.Token, Cancelled)).Status).toBe(409);
  expect((await Payments(Order)).N).toBe(0);
  expect((await Payments(Cancelled)).N).toBe(0);
});
