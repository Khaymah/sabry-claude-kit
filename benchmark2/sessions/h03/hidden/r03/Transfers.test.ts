import { beforeEach, expect, test } from "bun:test";
import { Call, Huge, MainBranch, NewBranch, NewMember, NewOrder, OrderIds, PlaceOrder, Transfer, Transfers, UserRow, Users, World, type Shop } from "../_Support";

let A: Shop;
let B: Shop;
let Nasr: number;
let Maadi: number;

beforeEach(async () => {
  ({ A, B } = await World());
  Nasr = await NewBranch(A.Owner.Token, "Nasr City");
  Maadi = await NewBranch(A.Owner.Token, "Maadi");
});

test("r03: a transferred staff member works on the new branch at once, with the same session", async () => {
  const Staff = await NewMember(A.Owner.Token, "Staff", Nasr);
  const NasrOrder = await NewOrder(Staff.Token, A);
  const MaadiOrder = await NewOrder(A.Owner.Token, A, Maadi);
  expect(await OrderIds(Staff.Token)).toEqual([NasrOrder]);

  const Res = await Transfer(A.Owner.Token, Staff.UserId, Maadi);
  expect([200, 201]).toContain(Res.Status);
  expect(Res.Body.Data.BranchId).toBe(Maadi);
  expect((await UserRow(A.Owner.Token, Staff.UserId)).BranchId).toBe(Maadi);

  expect(await OrderIds(Staff.Token)).toEqual([MaadiOrder]);
  expect([403, 404]).toContain((await Call("GET", `/Orders/${NasrOrder}`, { Token: Staff.Token })).Status);
  expect((await PlaceOrder(Staff.Token, A)).Body.Data.BranchId).toBe(Maadi);

  const History = await Transfers(A.Owner.Token, Staff.UserId);
  expect(History.map((T: any) => [T.FromBranchId, T.ToBranchId])).toEqual([[Nasr, Maadi]]);
});

test("r03: a transferred manager loses the old branch and nobody below Admin can transfer", async () => {
  const Manager = await NewMember(A.Owner.Token, "BranchManager", Nasr);
  const NasrStaff = await NewMember(Manager.Token, "Staff");
  expect((await Users(Manager.Token)).map((U: any) => U.Id)).toContain(NasrStaff.UserId);

  expect((await Transfer(Manager.Token, Manager.UserId, Maadi)).Status).toBe(403);
  expect((await Transfer(Manager.Token, NasrStaff.UserId, Maadi)).Status).toBe(403);
  expect((await Transfer(NasrStaff.Token, NasrStaff.UserId, Maadi)).Status).toBe(403);
  expect((await UserRow(A.Owner.Token, Manager.UserId)).BranchId).toBe(Nasr);
  expect((await UserRow(A.Owner.Token, NasrStaff.UserId)).BranchId).toBe(Nasr);

  expect([200, 201]).toContain((await Transfer(A.Owner.Token, Manager.UserId, Maadi)).Status);
  const Seen = await Users(Manager.Token);
  expect(Seen.map((U: any) => U.Id)).not.toContain(NasrStaff.UserId);
  expect(Seen.every((U: any) => U.BranchId === Maadi)).toBe(true);
  expect([403, 404]).toContain((await Call("POST", `/Users/${NasrStaff.UserId}/Deactivate`, { Token: Manager.Token })).Status);
  expect((await UserRow(A.Owner.Token, NasrStaff.UserId)).IsActive).toBe(true);
});

test("r03: two transfers of the same person at once leave a consistent history", async () => {
  const Zamalek = await NewBranch(A.Owner.Token, "Zamalek");
  const Admin = await NewMember(A.Owner.Token, "Admin");
  const Staff = await NewMember(A.Owner.Token, "Staff", Nasr);
  const Results = await Promise.all([Transfer(A.Owner.Token, Staff.UserId, Maadi), Transfer(Admin.Token, Staff.UserId, Zamalek)]);
  for (const R of Results) expect([200, 201, 409]).toContain(R.Status);
  const Succeeded = Results.filter((R) => R.Status === 200 || R.Status === 201).length;
  expect(Succeeded).toBeGreaterThanOrEqual(1);
  const Now = (await UserRow(A.Owner.Token, Staff.UserId)).BranchId;
  const History = await Transfers(A.Owner.Token, Staff.UserId);
  expect(History.length).toBe(Succeeded);
  expect(History[0].FromBranchId).toBe(Nasr);
  for (let I = 1; I < History.length; I++) expect(History[I].FromBranchId).toBe(History[I - 1].ToBranchId);
  expect(History[History.length - 1].ToBranchId).toBe(Now);
});

test("r03: transfers stay inside the company and reject bad ids", async () => {
  const Staff = await NewMember(A.Owner.Token, "Staff", Nasr);
  const BMain = await MainBranch(B.Owner.Token);
  for (const BranchId of [BMain, Huge]) {
    expect([400, 404]).toContain((await Transfer(A.Owner.Token, Staff.UserId, BranchId)).Status);
  }
  expect([400, 422]).toContain((await Call("POST", `/Users/${Staff.UserId}/Transfer`, { Token: A.Owner.Token, Body: { BranchId: "x" } })).Status);
  expect((await UserRow(A.Owner.Token, Staff.UserId)).BranchId).toBe(Nasr);
  expect((await Transfer(B.Owner.Token, Staff.UserId, BMain)).Status).toBe(404);
  expect([400, 404]).toContain((await Transfer(A.Owner.Token, Huge, Maadi)).Status);
  expect([403, 404]).toContain((await Call("GET", `/Users/${Staff.UserId}/Transfers`, { Token: B.Owner.Token })).Status);
  expect((await UserRow(A.Owner.Token, Staff.UserId)).BranchId).toBe(Nasr);
});
