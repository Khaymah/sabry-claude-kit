import { expect, test } from "bun:test";
import { Client } from "../../Src/Database/Db";
import { Migrate } from "../../Src/Database/Migrations";
import { Call, Reset, Sql } from "./_Support";

const Legacy: [string | null, string | null][] = [
  ["Ahmed@Example.COM", "ahmed@example.com"],
  ["  ahmed@example.com ", "ahmed@example.com"],
  [null, null],
  ["", null],
  ["   ", null],
  ["mona@example.com", "mona@example.com"],
];

async function LegacyWorld() {
  await Reset("0001_Init");
  const [A] = await Sql<{ Id: number }>(`INSERT INTO "Companies" ("Name") VALUES ('A') RETURNING "Id"`);
  const [B] = await Sql<{ Id: number }>(`INSERT INTO "Companies" ("Name") VALUES ('B') RETURNING "Id"`);
  const Ids: number[] = [];
  for (const [Email] of Legacy) {
    const [Row] = await Sql<{ Id: number }>(`INSERT INTO "Customers" ("CompanyId","Name","Email") VALUES ($1,'قديم',$2) RETURNING "Id"`, [A.Id, Email]);
    Ids.push(Row.Id);
  }
  await Sql(`INSERT INTO "Customers" ("CompanyId","Name","Email") VALUES ($1,'ب','ahmed@example.com')`, [B.Id]);
  return { A: A.Id, B: B.Id, Ids };
}

async function Ready() {
  const World = await LegacyWorld();
  await Migrate(Client);
  const Users = await Sql<{ Id: number }>(
    `INSERT INTO "Users" ("CompanyId","Email","Name","PasswordHash","Role") VALUES ($1,'oa@example.com','O','x','Owner'), ($2,'ob@example.com','O','x','Owner') RETURNING "Id"`,
    [World.A, World.B],
  );
  await Sql(`INSERT INTO "Sessions" ("Token","UserId","ExpiresAt") VALUES ('tok-a',$1, now() + interval '1 day'), ('tok-b',$2, now() + interval '1 day')`, [Users[0].Id, Users[1].Id]);
  return World;
}

test("legacy emails are backfilled in one normalized form, blanks become empty", async () => {
  const { Ids } = await LegacyWorld();
  await Migrate(Client);
  for (const [I, [Email, Expected]] of Legacy.entries()) {
    const [Row] = await Sql<{ Email: string | null; EmailNormalized: string | null }>(`SELECT "Email", "EmailNormalized" FROM "Customers" WHERE "Id" = $1`, [Ids[I]]);
    expect([Email, Row.EmailNormalized]).toEqual([Email, Expected]);
    expect(Row.Email).toBe(Email);
  }
  await Migrate(Client);
});

test("the backfill survives a big table full of blanks and duplicates", async () => {
  await Reset("0001_Init");
  const [A] = await Sql<{ Id: number }>(`INSERT INTO "Companies" ("Name") VALUES ('Big') RETURNING "Id"`);
  await Sql(
    `INSERT INTO "Customers" ("CompanyId","Name","Email")
     SELECT $1, 'c' || g, CASE WHEN g % 3 = 0 THEN NULL WHEN g % 3 = 1 THEN '' ELSE 'User' || (g % 500) || '@Mail.com ' END
     FROM generate_series(1, 9000) g`,
    [A.Id],
  );
  await Migrate(Client);
  const [Stats] = await Sql<{ Blank: number; Filled: number; Distinct: number }>(
    `SELECT count(*) FILTER (WHERE "EmailNormalized" IS NULL)::int AS "Blank", count("EmailNormalized")::int AS "Filled", count(DISTINCT "EmailNormalized")::int AS "Distinct" FROM "Customers"`,
  );
  expect(Stats).toEqual({ Blank: 6000, Filled: 3000, Distinct: 500 });
}, 60000);

test("lookup finds every legacy customer with that email whatever the case or spacing", async () => {
  await Ready();
  const Res = await Call("GET", `/Customers/Lookup?Email=${encodeURIComponent("  AHMED@example.com ")}`, { Token: "tok-a" });
  expect(Res.Status).toBe(200);
  expect(Res.Body.Data.length).toBe(2);
  const Other = await Call("GET", `/Customers/Lookup?Email=ahmed@example.com`, { Token: "tok-b" });
  expect(Other.Body.Data.map((C: any) => C.Name)).toEqual(["ب"]);
});

test("new customers cannot reuse an email, but customers without email are unlimited", async () => {
  await Ready();
  const Dup = await Call("POST", "/Customers", { Token: "tok-a", Body: { Name: "جديد", Email: "MONA@example.com" } });
  expect(Dup.Status).toBe(409);
  expect(Dup.Body.Error.Code).toBe("EMAIL_TAKEN");
  for (let I = 0; I < 3; I++) expect((await Call("POST", "/Customers", { Token: "tok-a", Body: { Name: `بدون ${I}` } })).Status).toBe(201);
  expect((await Call("POST", "/Customers", { Token: "tok-b", Body: { Name: "ب2", Email: "mona@example.com" } })).Status).toBe(201);
  const Fresh = await Call("POST", "/Customers", { Token: "tok-a", Body: { Name: "سارة", Email: "sara@example.com" } });
  expect(Fresh.Status).toBe(201);
  expect((await Call("PATCH", `/Customers/${Fresh.Body.Data.Id}`, { Token: "tok-a", Body: { Email: "Sara@Example.com" } })).Status).toBe(200);
  expect((await Call("PATCH", `/Customers/${Fresh.Body.Data.Id}`, { Token: "tok-a", Body: { Email: "mona@EXAMPLE.com" } })).Status).toBe(409);
});
