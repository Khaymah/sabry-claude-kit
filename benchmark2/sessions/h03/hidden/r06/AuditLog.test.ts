import { beforeEach, expect, test } from "bun:test";
import { Audit, AuditItems, Call, Huge, List, NewBranch, NewExpense, NewMember, NewOrder, PlaceOrder, Transfer, World, type Shop } from "../_Support";

let A: Shop;
let B: Shop;
let Nasr: number;
let Maadi: number;

beforeEach(async () => {
  ({ A, B } = await World());
  Nasr = await NewBranch(A.Owner.Token, "Nasr City");
  Maadi = await NewBranch(A.Owner.Token, "Maadi");
});

const Find = (Items: any[], Action: string, EntityId: number) => Items.filter((I: any) => I.Action === Action && I.EntityId === EntityId);

test("r06: the log records who did what, newest first", async () => {
  const Staff = await NewMember(A.Owner.Token, "Staff", Nasr);
  const Order = await NewOrder(Staff.Token, A);
  expect((await Call("POST", `/Orders/${Order}/Cancel`, { Token: Staff.Token })).Status).toBe(200);
  const Expense = await NewExpense(Staff.Token, "12.00", "2026-03-12");
  expect((await Call("DELETE", `/Expenses/${Expense}`, { Token: Staff.Token })).Status).toBe(200);
  expect([200, 201]).toContain((await Transfer(A.Owner.Token, Staff.UserId, Maadi)).Status);
  expect((await Call("POST", `/Users/${Staff.UserId}/Deactivate`, { Token: A.Owner.Token })).Status).toBe(200);
  expect([200, 201]).toContain((await Call("POST", `/Users/${Staff.UserId}/Activate`, { Token: A.Owner.Token })).Status);

  const Res = await Audit(A.Owner.Token);
  expect(Res.Status).toBe(200);
  expect(Res.Body.Data).toMatchObject({ Page: 1, PageSize: 100 });
  const Items = List(Res.Body);
  expect(Res.Body.Data.Total).toBe(Items.length);
  const Expect = (Action: string, EntityId: number, UserId: number) => {
    const Hits = Find(Items, Action, EntityId);
    expect(Hits.length).toBe(1);
    expect(Hits[0].UserId).toBe(UserId);
    return Hits[0];
  };
  expect(Expect("Branch.Create", Nasr, A.Owner.UserId).UserName).toBeTruthy();
  Expect("User.Create", Staff.UserId, A.Owner.UserId);
  const Created = Expect("Order.Create", Order, Staff.UserId);
  expect(Created.UserName).toMatch(/^Staff /);
  expect(Created.BranchId).toBe(Nasr);
  Expect("Order.Cancel", Order, Staff.UserId);
  Expect("Expense.Create", Expense, Staff.UserId);
  Expect("Expense.Delete", Expense, Staff.UserId);
  Expect("User.Transfer", Staff.UserId, A.Owner.UserId);
  Expect("User.Deactivate", Staff.UserId, A.Owner.UserId);
  Expect("User.Activate", Staff.UserId, A.Owner.UserId);
  const Pos = (Action: string) => Items.findIndex((I: any) => I.Action === Action && (I.EntityId === Order || I.EntityId === Staff.UserId));
  expect(Pos("User.Activate")).toBeLessThan(Pos("User.Deactivate"));
  expect(Pos("Order.Cancel")).toBeLessThan(Pos("Order.Create"));
  expect(Pos("Order.Create")).toBeLessThan(Pos("User.Create"));

  const OnlyCreates = List((await Audit(A.Owner.Token, "&Action=Order.Create")).Body);
  expect(OnlyCreates.length).toBeGreaterThan(0);
  expect(OnlyCreates.every((I: any) => I.Action === "Order.Create")).toBe(true);
  const ByStaff = List((await Audit(A.Owner.Token, `&UserId=${Staff.UserId}`)).Body);
  expect(ByStaff.map((I: any) => I.Action).sort()).toEqual(["Expense.Create", "Expense.Delete", "Order.Cancel", "Order.Create"]);
});

test("r06: refused or failed actions leave no trace", async () => {
  const Manager = await NewMember(A.Owner.Token, "BranchManager", Nasr);
  const Other = await NewMember(A.Owner.Token, "Staff", Maadi);
  const Order = await NewOrder(Manager.Token, A);
  const Cancels = await Promise.all([1, 2, 3].map(() => Call("POST", `/Orders/${Order}/Cancel`, { Token: Manager.Token })));
  expect(Cancels.filter((R) => R.Status === 200).length).toBe(1);
  expect([403, 404]).toContain((await Call("POST", `/Users/${Other.UserId}/Deactivate`, { Token: Manager.Token })).Status);
  expect([403, 404]).toContain((await Call("POST", `/Orders/${A.LegacyOrderId}/Cancel`, { Token: Manager.Token })).Status);
  expect((await PlaceOrder(Manager.Token, B)).Status).toBe(404);
  const Items = await AuditItems(A.Owner.Token);
  expect(Find(Items, "Order.Cancel", Order).length).toBe(1);
  expect(Find(Items, "User.Deactivate", Other.UserId).length).toBe(0);
  expect(Find(Items, "Order.Cancel", A.LegacyOrderId).length).toBe(0);
  expect(Items.filter((I: any) => I.Action === "Order.Create").length).toBe(1);
});

test("r06: a branch manager reviews only their own branch's activity", async () => {
  const Manager = await NewMember(A.Owner.Token, "BranchManager", Nasr);
  const NasrStaff = await NewMember(Manager.Token, "Staff");
  const MaadiStaff = await NewMember(A.Owner.Token, "Staff", Maadi);
  const NasrOrder = await NewOrder(NasrStaff.Token, A);
  const MaadiOrder = await NewOrder(MaadiStaff.Token, A);
  const MaadiExpense = await NewExpense(MaadiStaff.Token, "9.00", "2026-03-12");
  const Res = await Audit(Manager.Token);
  expect(Res.Status).toBe(200);
  const Items = List(Res.Body);
  expect(Find(Items, "Order.Create", NasrOrder).length).toBe(1);
  expect(Find(Items, "Order.Create", MaadiOrder).length).toBe(0);
  expect(Find(Items, "Expense.Create", MaadiExpense).length).toBe(0);
  expect(Items.some((I: any) => I.UserId === MaadiStaff.UserId)).toBe(false);
  const Staff = await Audit(NasrStaff.Token);
  if (Staff.Status === 200) expect(List(Staff.Body).some((I: any) => I.UserId === MaadiStaff.UserId)).toBe(false);
  else expect([403, 404]).toContain(Staff.Status);
});

test("r06: the log never crosses companies and rejects bad filters", async () => {
  await NewOrder(A.Owner.Token, A, Nasr);
  const BItems = await AuditItems(B.Owner.Token);
  expect(BItems.length).toBe(0);
  const Big = await Audit(A.Owner.Token, `&UserId=${Huge}`);
  if (Big.Status === 200) expect(List(Big.Body).length).toBe(0);
  else expect(Big.Status).toBe(400);
  expect((await Audit(A.Owner.Token, "&UserId=abc")).Status).toBe(400);
  expect((await Call("GET", "/AuditLogs?Page=0", { Token: A.Owner.Token })).Status).toBe(400);
});
