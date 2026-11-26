import { afterEach, beforeEach, expect, setSystemTime, test } from "bun:test";
import { Outbox } from "../../Src/Lib/Mailer";
import { Call, NewCompany, NewUser, Reset, Sql } from "./_Support";

let A: Awaited<ReturnType<typeof NewCompany>>;

beforeEach(async () => {
  await Reset();
  Outbox.length = 0;
  A = await NewCompany();
});

afterEach(() => {
  setSystemTime();
});

const Invite = (Email: string, Role: string, Token = A.Token) => Call("POST", "/Users/Invites", { Token, Body: { Email, Role } });
const Accept = (Token: string, Extra: Record<string, unknown> = {}) =>
  Call("POST", "/Users/Invites/Accept", { Body: { Token, Name: "موظف جديد", Password: "Welcome12345", ...Extra } });
const ChangeRole = (Id: number, Role: string, Token = A.Token) => Call("PATCH", `/Users/${Id}/Role`, { Token, Body: { Role } });

function InviteToken(Email: string) {
  const Mail = [...Outbox].reverse().find((M) => M.To === Email);
  expect(Mail).toBeDefined();
  const Match = /accept-invite\?token=([A-Za-z0-9_\-.~%]+)/.exec(Mail!.Body);
  expect(Match).not.toBeNull();
  return decodeURIComponent(Match![1]);
}

async function UserByEmail(Email: string) {
  return Sql<{ Id: number; CompanyId: number; Role: string }>(`SELECT "Id", "CompanyId", "Role" FROM "Users" WHERE "Email" = $1`, [Email]);
}

test("an invited person joins the inviting company with the invited role", async () => {
  expect((await Invite("new.staff@example.com", "Staff")).Status).toBe(201);
  const Res = await Accept(InviteToken("new.staff@example.com"), { Role: "Owner" });
  expect(Res.Status).toBe(201);
  const [User] = await UserByEmail("new.staff@example.com");
  expect(User).toMatchObject({ CompanyId: A.CompanyId, Role: "Staff" });
  const Login = await Call("POST", "/Auth/Login", { Body: { Email: "new.staff@example.com", Password: "Welcome12345" } });
  expect(Login.Status).toBe(200);
});

test("an invite link can be used only once, even twice at the same moment", async () => {
  await Invite("twice@example.com", "Admin");
  const Token = InviteToken("twice@example.com");
  const Results = await Promise.all([Accept(Token), Accept(Token), Accept(Token)]);
  expect(Results.filter((R) => R.Status === 201).length).toBe(1);
  expect((await UserByEmail("twice@example.com")).length).toBe(1);
  expect((await Accept(Token)).Status).toBe(400);
});

test("an invite expires after 7 days", async () => {
  const Start = Date.now();
  await Invite("late@example.com", "Staff");
  const Token = InviteToken("late@example.com");
  setSystemTime(new Date(Start + 8 * 86400_000));
  expect((await Accept(Token)).Status).toBe(400);
  expect((await UserByEmail("late@example.com")).length).toBe(0);
});

test("invite tokens are not stored in the clear", async () => {
  await Invite("secret@example.com", "Staff");
  const Token = InviteToken("secret@example.com");
  const Tables = await Sql<{ table_name: string }>(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`);
  for (const T of Tables) {
    const Rows = await Sql<{ J: string }>(`SELECT row_to_json(t)::text AS "J" FROM "${T.table_name}" t`);
    for (const R of Rows) expect(R.J.includes(Token)).toBe(false);
  }
});

test("staff cannot invite, nobody can invite an owner, and taken emails are refused", async () => {
  const Staff = await NewUser(A.CompanyId, "Staff");
  const Admin = await NewUser(A.CompanyId, "Admin");
  expect((await Invite("x1@example.com", "Staff", Staff.Token)).Status).toBe(403);
  expect((await Invite("x2@example.com", "Owner", Admin.Token)).Status).toBe(400);
  expect((await Invite("x3@example.com", "Staff", Admin.Token)).Status).toBe(201);
  expect((await Invite(A.Email, "Staff")).Status).toBe(409);
  expect(Outbox.map((M) => M.To)).toEqual(["x3@example.com"]);
});

test("role changes take effect immediately on existing sessions", async () => {
  const Staff = await NewUser(A.CompanyId, "Staff");
  const NewMember = { Email: "made.by.staff@example.com", Name: "X", Password: "Password123!", Role: "Staff" };
  expect((await Call("POST", "/Users", { Token: Staff.Token, Body: NewMember })).Status).toBe(403);
  expect((await ChangeRole(Staff.UserId, "Admin")).Status).toBe(200);
  expect((await Call("POST", "/Users", { Token: Staff.Token, Body: NewMember })).Status).toBe(201);
  expect((await ChangeRole(Staff.UserId, "Staff")).Status).toBe(200);
  expect((await Call("POST", "/Users", { Token: Staff.Token, Body: { ...NewMember, Email: "again@example.com" } })).Status).toBe(403);
});

test("only the owner changes roles, within the company, and the owner stays owner", async () => {
  const Admin = await NewUser(A.CompanyId, "Admin");
  const Staff = await NewUser(A.CompanyId, "Staff");
  expect((await ChangeRole(Staff.UserId, "Admin", Admin.Token)).Status).toBe(403);
  expect((await ChangeRole(Staff.UserId, "Owner")).Status).toBe(400);
  const Self = await ChangeRole(A.UserId, "Staff");
  expect(Self.Status).toBeGreaterThanOrEqual(400);
  expect(Self.Status).toBeLessThan(500);
  const B = await NewCompany();
  expect((await ChangeRole(Staff.UserId, "Admin", B.Token)).Status).toBe(404);
  const Rows = await Sql<{ Id: number; Role: string }>(`SELECT "Id", "Role" FROM "Users" WHERE "Id" = ANY($1::int[]) ORDER BY "Id"`, [[A.UserId, Staff.UserId]]);
  expect(Rows.map((R) => R.Role)).toEqual(["Owner", "Staff"]);
});
