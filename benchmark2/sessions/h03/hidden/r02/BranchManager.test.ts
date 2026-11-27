import { beforeEach, expect, test } from "bun:test";
import { AddUser, Call, Huge, MainBranch, NewBranch, NewMember, OrderIds, PlaceOrder, UserCountByEmail, UserRow, Users, World, type Shop } from "../_Support";

let A: Shop;
let B: Shop;
let Nasr: number;
let Maadi: number;
let Manager: Awaited<ReturnType<typeof NewMember>>;

beforeEach(async () => {
  ({ A, B } = await World());
  Nasr = await NewBranch(A.Owner.Token, "Nasr City");
  Maadi = await NewBranch(A.Owner.Token, "Maadi");
  Manager = await NewMember(A.Owner.Token, "BranchManager", Nasr);
});

test("r02: a branch manager adds staff to their branch and only sees their branch", async () => {
  expect((await UserRow(A.Owner.Token, Manager.UserId)).BranchId).toBe(Nasr);
  const Plain = await NewMember(Manager.Token, "Staff");
  const Explicit = await NewMember(Manager.Token, "Staff", Nasr);
  expect((await UserRow(A.Owner.Token, Plain.UserId)).BranchId).toBe(Nasr);
  expect((await UserRow(A.Owner.Token, Explicit.UserId)).BranchId).toBe(Nasr);
  await NewMember(A.Owner.Token, "Staff", Maadi);

  const Seen = await Users(Manager.Token);
  expect(Seen.map((U: any) => U.Id)).toEqual(expect.arrayContaining([Manager.UserId, Plain.UserId, Explicit.UserId]));
  expect(Seen.every((U: any) => U.BranchId === Nasr)).toBe(true);

  const Order = await PlaceOrder(Manager.Token, A);
  expect(Order.Body.Data.BranchId).toBe(Nasr);
  expect(await OrderIds(Manager.Token)).toEqual([Order.Body.Data.Id]);
  expect([403, 404]).toContain((await Call("GET", `/Orders/${A.LegacyOrderId}`, { Token: Manager.Token })).Status);
});

test("r02: a branch manager cannot hand out wider roles", async () => {
  for (const Role of ["Admin", "Owner", "BranchManager"]) {
    const { Email, Res } = await AddUser(Manager.Token, Role);
    expect([400, 403]).toContain(Res.Status);
    expect(await UserCountByEmail(Email)).toBe(0);
  }
  const Staff = await NewMember(Manager.Token, "Staff");
  expect((await AddUser(Staff.Token, "Staff")).Res.Status).toBe(403);
});

test("r02: a branch manager cannot add people to another branch", async () => {
  const Main = await MainBranch(A.Owner.Token);
  const BMain = await MainBranch(B.Owner.Token);
  for (const BranchId of [Maadi, Main, BMain, Huge]) {
    const { Email, Res } = await AddUser(Manager.Token, "Staff", BranchId);
    if (Res.Status === 201) expect((await UserRow(A.Owner.Token, Res.Body.Data.Id)).BranchId).toBe(Nasr);
    else expect([400, 403, 404]).toContain(Res.Status);
    expect(await UserCountByEmail(Email)).toBeLessThanOrEqual(1);
  }
  const Everyone = await Users(A.Owner.Token);
  expect(Everyone.filter((U: any) => U.BranchId === Maadi).length).toBe(0);
});

test("r02: a branch manager deactivates only their own branch's staff", async () => {
  const Mine = await NewMember(Manager.Token, "Staff");
  const Other = await NewMember(A.Owner.Token, "Staff", Maadi);
  const Admin = await NewMember(A.Owner.Token, "Admin");
  for (const Target of [Other.UserId, Admin.UserId, A.Owner.UserId, A.Staff.UserId, B.Staff.UserId]) {
    expect([403, 404]).toContain((await Call("POST", `/Users/${Target}/Deactivate`, { Token: Manager.Token })).Status);
  }
  for (const Target of [Other.UserId, Admin.UserId, A.Owner.UserId, A.Staff.UserId]) {
    expect((await UserRow(A.Owner.Token, Target)).IsActive).toBe(true);
  }
  expect([400, 404]).toContain((await Call("POST", `/Users/${Huge}/Deactivate`, { Token: Manager.Token })).Status);
  expect((await Call("POST", `/Users/${Mine.UserId}/Deactivate`, { Token: Manager.Token })).Status).toBe(200);
  expect((await UserRow(A.Owner.Token, Mine.UserId)).IsActive).toBe(false);
  expect((await Call("POST", `/Users/${Other.UserId}/Deactivate`, { Token: Mine.Token })).Status).not.toBe(200);
});
