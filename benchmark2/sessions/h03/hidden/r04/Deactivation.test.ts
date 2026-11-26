import { beforeEach, expect, test } from "bun:test";
import { Call, Huge, Login, NewBranch, NewMember, UserRow, World, type Shop } from "../_Support";

let A: Shop;
let B: Shop;
let Nasr: number;
let Maadi: number;

beforeEach(async () => {
  ({ A, B } = await World());
  Nasr = await NewBranch(A.Owner.Token, "Nasr City");
  Maadi = await NewBranch(A.Owner.Token, "Maadi");
});

const Works = async (Token: string) => (await Call("GET", "/Orders", { Token })).Status;
const Activate = (Token: string, UserId: number) => Call("POST", `/Users/${UserId}/Activate`, { Token });
const Deactivate = (Token: string, UserId: number) => Call("POST", `/Users/${UserId}/Deactivate`, { Token });

test("r04: deactivating someone ends every open session immediately", async () => {
  const Staff = await NewMember(A.Owner.Token, "Staff", Nasr);
  const Second = await Login(Staff.Email);
  expect(await Works(Staff.Token)).toBe(200);
  expect(await Works(Second.Token)).toBe(200);
  expect(await Works(A.Staff.Token)).toBe(200);

  expect((await Deactivate(A.Owner.Token, Staff.UserId)).Status).toBe(200);
  expect((await Deactivate(A.Owner.Token, A.Staff.UserId)).Status).toBe(200);
  for (const Token of [Staff.Token, Second.Token, A.Staff.Token]) {
    expect(await Works(Token)).toBe(401);
    expect((await Call("GET", "/Auth/Me", { Token })).Status).toBe(401);
  }
  expect((await Login(Staff.Email)).Status).toBe(401);
});

test("r04: an activated user must log in again and old sessions stay dead", async () => {
  const Staff = await NewMember(A.Owner.Token, "Staff", Nasr);
  expect(await Works(Staff.Token)).toBe(200);
  expect((await Deactivate(A.Owner.Token, Staff.UserId)).Status).toBe(200);
  expect([200, 201]).toContain((await Activate(A.Owner.Token, Staff.UserId)).Status);
  expect((await UserRow(A.Owner.Token, Staff.UserId)).IsActive).toBe(true);
  expect(await Works(Staff.Token)).toBe(401);
  const Fresh = await Login(Staff.Email);
  expect(Fresh.Status).toBe(200);
  expect(await Works(Fresh.Token)).toBe(200);
  expect((await UserRow(A.Owner.Token, Staff.UserId)).BranchId).toBe(Nasr);
});

test("r04: a branch manager activates and deactivates only their own branch's staff", async () => {
  const Manager = await NewMember(A.Owner.Token, "BranchManager", Nasr);
  const Mine = await NewMember(Manager.Token, "Staff");
  const Other = await NewMember(A.Owner.Token, "Staff", Maadi);
  expect(await Works(Mine.Token)).toBe(200);
  expect((await Deactivate(Manager.Token, Mine.UserId)).Status).toBe(200);
  expect(await Works(Mine.Token)).toBe(401);
  expect([200, 201]).toContain((await Activate(Manager.Token, Mine.UserId)).Status);
  expect((await Login(Mine.Email)).Status).toBe(200);

  expect((await Deactivate(A.Owner.Token, Other.UserId)).Status).toBe(200);
  expect([403, 404]).toContain((await Activate(Manager.Token, Other.UserId)).Status);
  expect((await UserRow(A.Owner.Token, Other.UserId)).IsActive).toBe(false);
  expect((await Login(Other.Email)).Status).toBe(401);

  const Fresh = await Login(Mine.Email);
  expect([403, 404]).toContain((await Activate(Fresh.Token, Other.UserId)).Status);
  expect((await UserRow(A.Owner.Token, Other.UserId)).IsActive).toBe(false);
});

test("r04: activation stays inside the company and rejects bad ids", async () => {
  expect((await Deactivate(B.Owner.Token, B.Staff.UserId)).Status).toBe(200);
  expect((await Activate(A.Owner.Token, B.Staff.UserId)).Status).toBe(404);
  expect([400, 404]).toContain((await Activate(A.Owner.Token, Huge)).Status);
  expect([400, 404]).toContain((await Call("POST", "/Users/abc/Activate", { Token: A.Owner.Token })).Status);
  expect((await UserRow(B.Owner.Token, B.Staff.UserId)).IsActive).toBe(false);
});
