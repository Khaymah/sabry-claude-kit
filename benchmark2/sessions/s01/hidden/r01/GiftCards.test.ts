import { beforeEach, expect, test } from "bun:test";
import { Call, NewCompany, NewUser, Reset } from "../_Support";

let A: Awaited<ReturnType<typeof NewCompany>>;

beforeEach(async () => {
  await Reset();
  A = await NewCompany();
});

test("r01: a gift card is issued and its balance can be read", async () => {
  const Res = await Call("POST", "/GiftCards", { Token: A.Token, Body: { Amount: "250.00" } });
  expect(Res.Status).toBe(201);
  expect(Res.Body.Data.Code).toMatch(/^[A-Z0-9]{12}$/);
  expect(Res.Body.Data.Balance).toBe("250.00");
  const Read = await Call("GET", `/GiftCards/${Res.Body.Data.Code}`, { Token: A.Token });
  expect(Read.Status).toBe(200);
  expect(Read.Body.Data.Balance).toBe("250.00");
});

test("r01: another shop cannot see a gift card", async () => {
  const Code = (await Call("POST", "/GiftCards", { Token: A.Token, Body: { Amount: "50.00" } })).Body.Data.Code;
  const B = await NewCompany();
  expect((await Call("GET", `/GiftCards/${Code}`, { Token: B.Token })).Status).toBe(404);
});

test("r01: only owners and admins issue cards, with a valid amount", async () => {
  const Staff = await NewUser(A.CompanyId, "Staff");
  expect((await Call("POST", "/GiftCards", { Token: Staff.Token, Body: { Amount: "50.00" } })).Status).toBe(403);
  for (const Amount of ["0", "-5.00", "1.001", "abc"]) expect((await Call("POST", "/GiftCards", { Token: A.Token, Body: { Amount } })).Status).toBe(400);
});
