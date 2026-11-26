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

function RequestReset(Email: string) {
  return Call("POST", "/Auth/PasswordReset/Request", { Body: { Email } });
}

function Confirm(Token: string, NewPassword = "FreshPassword1") {
  return Call("POST", "/Auth/PasswordReset/Confirm", { Body: { Token, NewPassword } });
}

function LastToken(Email: string) {
  const Mail = [...Outbox].reverse().find((M) => M.To === Email);
  expect(Mail).toBeDefined();
  const Match = /reset-password\?token=([A-Za-z0-9_\-.~%]+)/.exec(Mail!.Body);
  expect(Match).not.toBeNull();
  return decodeURIComponent(Match![1]);
}

const Login = (Email: string, Password: string) => Call("POST", "/Auth/Login", { Body: { Email, Password } });

test("known and unknown emails get the same answer, only the known one gets mail", async () => {
  const Known = await RequestReset(A.Email);
  const Unknown = await RequestReset("nobody@example.com");
  expect(Known.Status).toBe(Unknown.Status);
  expect(Known.Status).toBe(200);
  expect(Known.Text).toBe(Unknown.Text);
  expect(Outbox.map((M) => M.To)).toEqual([A.Email]);
});

test("a reset link sets the new password and signs out every session", async () => {
  const Other = await Login(A.Email, A.Password);
  await RequestReset(`  ${A.Email.toUpperCase()} `);
  const Res = await Confirm(LastToken(A.Email));
  expect(Res.Status).toBe(200);
  expect((await Login(A.Email, A.Password)).Status).toBe(401);
  expect((await Login(A.Email, "FreshPassword1")).Status).toBe(200);
  expect((await Call("GET", "/Auth/Me", { Token: A.Token })).Status).toBe(401);
  expect((await Call("GET", "/Auth/Me", { Token: Other.Body.Data.Token })).Status).toBe(401);
});

test("a reset link works only once, even when submitted twice at the same time", async () => {
  await RequestReset(A.Email);
  const Token = LastToken(A.Email);
  const [First, Second] = await Promise.all([Confirm(Token, "FirstPassword1"), Confirm(Token, "SecondPassword2")]);
  expect([First.Status, Second.Status].sort()).toEqual([200, 400]);
  const Winner = First.Status === 200 ? "FirstPassword1" : "SecondPassword2";
  expect((await Login(A.Email, Winner)).Status).toBe(200);
  expect((await Confirm(Token, "ThirdPassword3")).Status).toBe(400);
  expect((await Login(A.Email, Winner)).Status).toBe(200);
});

test("a reset link expires after 30 minutes", async () => {
  const Start = Date.now();
  await RequestReset(A.Email);
  const Token = LastToken(A.Email);
  setSystemTime(new Date(Start + 31 * 60_000));
  expect((await Confirm(Token)).Status).toBe(400);
  setSystemTime();
  expect((await Login(A.Email, A.Password)).Status).toBe(200);
});

test("a link still works within its lifetime", async () => {
  const Start = Date.now();
  await RequestReset(A.Email);
  const Token = LastToken(A.Email);
  setSystemTime(new Date(Start + 25 * 60_000));
  expect((await Confirm(Token)).Status).toBe(200);
});

test("the raw token is never stored", async () => {
  await RequestReset(A.Email);
  const Token = LastToken(A.Email);
  const Tables = await Sql<{ table_name: string }>(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`);
  for (const T of Tables) {
    const Rows = await Sql<{ J: string }>(`SELECT row_to_json(t)::text AS "J" FROM "${T.table_name}" t`);
    for (const R of Rows) expect(R.J.includes(Token)).toBe(false);
  }
});

test("a weak new password is refused without burning the link", async () => {
  await RequestReset(A.Email);
  const Token = LastToken(A.Email);
  expect((await Confirm(Token, "short")).Status).toBe(400);
  expect((await Confirm(Token, "LongEnough99")).Status).toBe(200);
});

test("garbage tokens and deactivated users get nothing", async () => {
  expect((await Confirm("not-a-real-token")).Status).toBe(400);
  const Staff = await NewUser(A.CompanyId, "Staff");
  await Sql(`UPDATE "Users" SET "IsActive" = false WHERE "Id" = $1`, [Staff.UserId]);
  const Res = await RequestReset(Staff.Email);
  expect(Res.Status).toBe(200);
  expect(Outbox.length).toBe(0);
});
