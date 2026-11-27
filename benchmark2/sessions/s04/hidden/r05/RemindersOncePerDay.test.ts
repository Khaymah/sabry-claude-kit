import { afterEach, beforeEach, expect, setSystemTime, test } from "bun:test";
import { Call, InstallSms, NewCompany, NewCustomer, Reset, RestoreFetch, SmsCalls, SmsSettings, Sql } from "../_Support";

let A: Awaited<ReturnType<typeof NewCompany>>;

beforeEach(async () => {
  await Reset();
  await SmsSettings();
  InstallSms("ok");
  A = await NewCompany();
  const C = await NewCustomer(A.CompanyId, { Phone: "01000000009" });
  for (let I = 0; I < 3; I++)
    await Sql(`INSERT INTO "Orders" ("CompanyId","CustomerId","Status","Subtotal","Tax","Total","CreatedAt") VALUES ($1,$2,'Pending','10','1.40','11.40', now() - interval '5 days')`, [A.CompanyId, C]);
});

afterEach(() => {
  RestoreFetch();
  setSystemTime();
});

const Run = () => Call("POST", "/Jobs/PaymentReminders", { Token: A.Token });

test("r05: running the reminders twice in a day texts each order once", async () => {
  expect((await Run()).Body.Data.Sent).toBe(3);
  expect((await Run()).Body.Data.Sent).toBe(0);
  expect(SmsCalls.length).toBe(3);
});

test("r05: two runs at the same moment still text each order once", async () => {
  await Promise.all([Run(), Run()]);
  expect(SmsCalls.length).toBe(3);
  expect(new Set(SmsCalls.map((C) => C.Body.Reference)).size).toBe(3);
});

test("r05: the next day the reminders go out again", async () => {
  await Run();
  setSystemTime(new Date(Date.now() + 86400_000 + 60_000));
  expect((await Run()).Body.Data.Sent).toBe(3);
  expect(SmsCalls.length).toBe(6);
});
