import { beforeEach, expect, test } from "bun:test";
import { Call, NewCompany, NewUser, Reset, Sql } from "./_Support";

beforeEach(async () => {
  await Reset();
});

async function Login(Email: string, Password: string) {
  return Call("POST", "/Auth/Login", { Body: { Email, Password } });
}

async function Works(Token: string) {
  return (await Call("GET", "/Auth/Me", { Token })).Status === 200;
}

test("logout ends exactly the caller's session and nobody else's", async () => {
  const Owner = await NewCompany();
  const OwnerLaptop = (await Login(Owner.Email, Owner.Password)).Body.Data.Token;
  const OwnerTablet = (await Login(Owner.Email, Owner.Password)).Body.Data.Token;
  const Staff = await NewUser(Owner.CompanyId, "Staff");
  const Other = await NewUser(Owner.CompanyId, "Staff");
  const Res = await Call("POST", "/Auth/Logout", { Token: Staff.Token });
  expect(Res.Status).toBe(200);
  expect(await Works(Staff.Token)).toBe(false);
  expect(await Works(Owner.Token)).toBe(true);
  expect(await Works(OwnerLaptop)).toBe(true);
  expect(await Works(OwnerTablet)).toBe(true);
  expect(await Works(Other.Token)).toBe(true);
  const Again = await Call("POST", "/Auth/Logout", { Token: Other.Token });
  expect(Again.Status).toBe(200);
  expect(await Works(Other.Token)).toBe(false);
  expect(await Works(OwnerTablet)).toBe(true);
});

test("a deactivated user is locked out of existing sessions", async () => {
  const Owner = await NewCompany();
  const Staff = await NewUser(Owner.CompanyId, "Staff");
  const Phone = (await Login(Staff.Email, Staff.Password)).Body.Data.Token;
  expect(await Works(Phone)).toBe(true);
  const Res = await Call("POST", `/Users/${Staff.UserId}/Deactivate`, { Token: Owner.Token });
  expect(Res.Status).toBe(200);
  expect(await Works(Phone)).toBe(false);
  expect(await Works(Staff.Token)).toBe(false);
  expect((await Call("GET", "/Orders", { Token: Phone })).Status).toBe(401);
  expect((await Login(Staff.Email, Staff.Password)).Status).toBe(401);
  expect(await Works(Owner.Token)).toBe(true);
});

test("changing the password signs out the other devices but keeps the current one", async () => {
  const Owner = await NewCompany();
  const Phone = (await Login(Owner.Email, Owner.Password)).Body.Data.Token;
  const Laptop = (await Login(Owner.Email, Owner.Password)).Body.Data.Token;
  const Colleague = await NewUser(Owner.CompanyId, "Staff");
  const Res = await Call("POST", "/Users/Me/Password", {
    Token: Laptop,
    Body: { CurrentPassword: Owner.Password, NewPassword: "BrandNewPass99" },
  });
  expect(Res.Status).toBe(200);
  expect(await Works(Phone)).toBe(false);
  expect(await Works(Owner.Token)).toBe(false);
  expect(await Works(Colleague.Token)).toBe(true);
  expect((await Login(Owner.Email, Owner.Password)).Status).toBe(401);
  expect((await Login(Owner.Email, "BrandNewPass99")).Status).toBe(200);
});

test("a failed password change revokes nothing", async () => {
  const Owner = await NewCompany();
  const Phone = (await Login(Owner.Email, Owner.Password)).Body.Data.Token;
  const Res = await Call("POST", "/Users/Me/Password", { Token: Owner.Token, Body: { CurrentPassword: "wrong-one", NewPassword: "BrandNewPass99" } });
  expect(Res.Status).toBe(400);
  expect(await Works(Phone)).toBe(true);
  expect(await Works(Owner.Token)).toBe(true);
});

test("expired sessions are still rejected", async () => {
  const Owner = await NewCompany();
  await Sql(`UPDATE "Sessions" SET "ExpiresAt" = now() - interval '1 minute' WHERE "Token" = $1`, [Owner.Token]);
  expect(await Works(Owner.Token)).toBe(false);
  const Fresh = await Login(Owner.Email, Owner.Password);
  expect(Fresh.Status).toBe(200);
  expect(await Works(Fresh.Body.Data.Token)).toBe(true);
});
