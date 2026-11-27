import { beforeEach, expect, test } from "bun:test";
import {
  AddExpense, AddUser, AuditItems, Branches, Call, Huge, List, MainBranch, NewBranch, NewMember, NewOrder, OrderIds, PlaceOrder,
  SetOrderDate, Transfer, Transfers, UserCountByEmail, UserRow, Users, World, type Shop,
} from "../_Support";

let A: Shop;
let B: Shop;
let Main: number;
let Nasr: number;
let Maadi: number;

beforeEach(async () => {
  ({ A, B } = await World());
  Main = await MainBranch(A.Owner.Token);
  Nasr = await NewBranch(A.Owner.Token, "Nasr City");
  Maadi = await NewBranch(A.Owner.Token, "Maadi");
});

const Close = (Token: string, BranchId: number | string, MoveStaffTo: number) => Call("POST", `/Branches/${BranchId}/Close`, { Token, Body: { MoveStaffTo } });
const IsClosed = async (BranchId: number) => (await Branches(A.Owner.Token)).find((X: any) => X.Id === BranchId)?.IsClosed === true;

test("r08: closing a branch moves its people, who keep working on the new branch, and keeps its history", async () => {
  const Manager = await NewMember(A.Owner.Token, "BranchManager", Nasr);
  const Staff = await NewMember(Manager.Token, "Staff");
  const Cashier = await NewMember(Manager.Token, "Cashier");
  const NasrOrder = await NewOrder(Staff.Token, A);
  await SetOrderDate(NasrOrder, "2026-03-05T12:00:00Z");
  const MaadiOrder = await NewOrder(A.Owner.Token, A, Maadi);
  expect(await OrderIds(Staff.Token)).toEqual([NasrOrder]);

  expect([200, 201]).toContain((await Close(A.Owner.Token, Nasr, Maadi)).Status);
  expect(await IsClosed(Nasr)).toBe(true);
  expect(await IsClosed(Maadi)).toBe(false);
  for (const U of [Manager, Staff, Cashier]) expect((await UserRow(A.Owner.Token, U.UserId)).BranchId).toBe(Maadi);
  expect((await Users(A.Owner.Token)).filter((U: any) => U.BranchId === Nasr).length).toBe(0);

  expect(await OrderIds(Staff.Token)).toEqual([MaadiOrder]);
  expect([403, 404]).toContain((await Call("GET", `/Orders/${NasrOrder}`, { Token: Staff.Token })).Status);
  expect((await PlaceOrder(Cashier.Token, A)).Body.Data.BranchId).toBe(Maadi);
  expect((await Users(Manager.Token)).every((U: any) => U.BranchId === Maadi)).toBe(true);

  const History = await Transfers(A.Owner.Token, Staff.UserId);
  expect(History.length).toBe(1);
  expect([History[0].FromBranchId, History[0].ToBranchId]).toEqual([Nasr, Maadi]);
  expect((await AuditItems(A.Owner.Token)).filter((I: any) => I.Action === "Branch.Close" && I.EntityId === Nasr).length).toBe(1);

  const Report = await Call("GET", `/Reports/Branches?From=2026-03-01&To=2026-03-31&BranchId=${Nasr}`, { Token: A.Owner.Token });
  expect(Report.Status).toBe(200);
  expect(List(Report.Body).find((R: any) => R.BranchId === Nasr)).toMatchObject({ OrdersCount: 1, Sales: "114.00" });
});

test("r08: a closed branch takes no new orders, expenses or people", async () => {
  const Staff = await NewMember(A.Owner.Token, "Staff", Maadi);
  expect([200, 201]).toContain((await Close(A.Owner.Token, Nasr, Main)).Status);
  const Refused = [400, 403, 404, 409];
  expect(Refused).toContain((await PlaceOrder(A.Owner.Token, A, Nasr)).Status);
  expect(Refused).toContain((await AddExpense(A.Owner.Token, "5.00", "2026-03-12", Nasr)).Status);
  for (const Role of ["Staff", "BranchManager", "Cashier"]) {
    const { Email, Res } = await AddUser(A.Owner.Token, Role, Nasr);
    expect(Refused).toContain(Res.Status);
    expect(await UserCountByEmail(Email)).toBe(0);
  }
  expect(Refused).toContain((await Transfer(A.Owner.Token, Staff.UserId, Nasr)).Status);
  expect((await UserRow(A.Owner.Token, Staff.UserId)).BranchId).toBe(Maadi);
  const [Count] = await Call("GET", "/Orders?Page=1&PageSize=100", { Token: A.Owner.Token }).then((R) => [List(R.Body).filter((O: any) => O.BranchId === Nasr).length]);
  expect(Count).toBe(0);
});

test("r08: transfers racing with the close never leave anyone in the closed branch", async () => {
  const Zamalek = await NewBranch(A.Owner.Token, "Zamalek");
  const Admin = await NewMember(A.Owner.Token, "Admin");
  const Movers = [];
  for (let I = 0; I < 6; I++) Movers.push(await NewMember(A.Owner.Token, "Staff", Zamalek));
  await NewMember(A.Owner.Token, "Staff", Nasr);
  const Moves = Movers.map((M, I) => () => Transfer(I % 2 ? Admin.Token : A.Owner.Token, M.UserId, Nasr));
  const Results = await Promise.all([...Moves.slice(0, 3).map((F) => F()), Close(A.Owner.Token, Nasr, Maadi), ...Moves.slice(3).map((F) => F())]);
  expect([200, 201]).toContain(Results[3].Status);
  for (const R of Results) expect([200, 201, 400, 403, 404, 409]).toContain(R.Status);
  expect((await Users(A.Owner.Token)).filter((U: any) => U.BranchId === Nasr).length).toBe(0);
  for (const M of Movers) expect([Maadi, Zamalek]).toContain((await UserRow(A.Owner.Token, M.UserId)).BranchId);
  expect(await IsClosed(Nasr)).toBe(true);
});

test("r08: only the owner closes a branch, and bad closes change nothing", async () => {
  const Admin = await NewMember(A.Owner.Token, "Admin");
  const Manager = await NewMember(A.Owner.Token, "BranchManager", Nasr);
  expect((await Close(Admin.Token, Nasr, Maadi)).Status).toBe(403);
  expect((await Close(Manager.Token, Nasr, Maadi)).Status).toBe(403);
  const BMain = await MainBranch(B.Owner.Token);
  expect([400, 409]).toContain((await Close(A.Owner.Token, Main, Maadi)).Status);
  expect([400, 409]).toContain((await Close(A.Owner.Token, Nasr, Nasr)).Status);
  expect([400, 404]).toContain((await Close(A.Owner.Token, Nasr, BMain)).Status);
  expect([400, 404]).toContain((await Close(A.Owner.Token, Nasr, Huge)).Status);
  expect([400, 404]).toContain((await Close(A.Owner.Token, Huge, Maadi)).Status);
  expect((await Close(B.Owner.Token, Nasr, BMain)).Status).toBe(404);
  expect(await IsClosed(Nasr)).toBe(false);
  expect(await IsClosed(Main)).toBe(false);
  expect((await UserRow(A.Owner.Token, Manager.UserId)).BranchId).toBe(Nasr);

  expect([200, 201]).toContain((await Close(A.Owner.Token, Maadi, Main)).Status);
  expect([400, 409]).toContain((await Close(A.Owner.Token, Nasr, Maadi)).Status);
  expect([400, 409]).toContain((await Close(A.Owner.Token, Maadi, Main)).Status);
  expect(await IsClosed(Nasr)).toBe(false);
  expect((await UserRow(A.Owner.Token, Manager.UserId)).BranchId).toBe(Nasr);
});
