import { beforeEach, expect, test } from "bun:test";
import { Client } from "../../Src/Database/Db";
import { Migrate } from "../../Src/Database/Migrations";
import { Call, NewCompany, NewCustomer, Reset, Sql } from "./_Support";

const Cases: [string | null, string | null][] = [
  ["01001234567", "+201001234567"],
  ["010 0123 4567", "+201001234567"],
  ["+20 100 123 4567", "+201001234567"],
  ["00201001234567", "+201001234567"],
  ["201001234567", "+201001234567"],
  ["1001234567", "+201001234567"],
  ["٠١٠٠١٢٣٤٥٦٧", "+201001234567"],
  ["0122-333-4444", "+201223334444"],
  ["01512345678", "+201512345678"],
  ["01612345678", null],
  ["0223456789", null],
  ["12345", null],
  ["+44 7700 900123", null],
  ["", null],
  [null, null],
];

async function OldWorld() {
  await Reset("0001_Init");
  const [A] = await Sql<{ Id: number }>(`INSERT INTO "Companies" ("Name") VALUES ('A') RETURNING "Id"`);
  const [B] = await Sql<{ Id: number }>(`INSERT INTO "Companies" ("Name") VALUES ('B') RETURNING "Id"`);
  const Ids: number[] = [];
  for (const [Phone] of Cases) {
    const [Row] = await Sql<{ Id: number }>(`INSERT INTO "Customers" ("CompanyId","Name","Phone") VALUES ($1,'قديم',$2) RETURNING "Id"`, [A.Id, Phone]);
    Ids.push(Row.Id);
  }
  await Sql(`INSERT INTO "Customers" ("CompanyId","Name","Phone") VALUES ($1,'شركة ب','01001234567')`, [B.Id]);
  return { A: A.Id, B: B.Id, Ids };
}

test("the migration backfills normalized phones for existing customers", async () => {
  const { Ids } = await OldWorld();
  await Migrate(Client);
  for (const [I, [Phone, Expected]] of Cases.entries()) {
    const [Row] = await Sql<{ Phone: string | null; PhoneNormalized: string | null }>(`SELECT "Phone", "PhoneNormalized" FROM "Customers" WHERE "Id" = $1`, [Ids[I]]);
    expect([Phone, Row.PhoneNormalized]).toEqual([Phone, Expected]);
    expect(Row.Phone).toBe(Phone);
  }
  await Migrate(Client);
});

test("the backfill copes with a large table that already has duplicates", async () => {
  await Reset("0001_Init");
  const [A] = await Sql<{ Id: number }>(`INSERT INTO "Companies" ("Name") VALUES ('Big') RETURNING "Id"`);
  await Sql(
    `INSERT INTO "Customers" ("CompanyId","Name","Phone") SELECT $1, 'c' || g, '010' || lpad((g % 15000)::text, 8, '0') FROM generate_series(1, 20000) g`,
    [A.Id],
  );
  await Migrate(Client);
  const [Stats] = await Sql<{ Missing: number; Dupes: number }>(
    `SELECT count(*) FILTER (WHERE "PhoneNormalized" IS NULL)::int AS "Missing",
            (count(*) - count(DISTINCT "PhoneNormalized"))::int AS "Dupes" FROM "Customers"`,
  );
  expect(Stats.Missing).toBe(0);
  expect(Stats.Dupes).toBe(5000);
  const [One] = await Sql<{ PhoneNormalized: string }>(`SELECT "PhoneNormalized" FROM "Customers" WHERE "Name" = 'c7'`);
  expect(One.PhoneNormalized).toBe("+201000000007");
}, 120000);

async function Ready() {
  await OldWorld();
  await Migrate(Client);
  const [A] = await Sql<{ Id: number }>(`SELECT "Id" FROM "Companies" WHERE "Name" = 'A'`);
  const [B] = await Sql<{ Id: number }>(`SELECT "Id" FROM "Companies" WHERE "Name" = 'B'`);
  const Owner = await Sql<{ Id: number }>(
    `INSERT INTO "Users" ("CompanyId","Email","Name","PasswordHash","Role") VALUES ($1,'owner-a@example.com','O','x','Owner'), ($2,'owner-b@example.com','O','x','Owner') RETURNING "Id"`,
    [A.Id, B.Id],
  );
  await Sql(`INSERT INTO "Sessions" ("Token","UserId","ExpiresAt") VALUES ('tok-a',$1, now() + interval '1 day'), ('tok-b',$2, now() + interval '1 day')`, [Owner[0].Id, Owner[1].Id]);
  return { A: A.Id, B: B.Id };
}

test("lookup finds customers whatever format the phone is typed in", async () => {
  await Ready();
  for (const Typed of ["01001234567", "+20 100 123 4567", "٠١٠٠١٢٣٤٥٦٧", "1001234567"]) {
    const Res = await Call("GET", `/Customers/Lookup?Phone=${encodeURIComponent(Typed)}`, { Token: "tok-a" });
    expect(Res.Status).toBe(200);
    expect(Res.Body.Data.length).toBe(7);
    expect(Res.Body.Data.every((C: any) => C.Name === "قديم")).toBe(true);
  }
  const Other = await Call("GET", `/Customers/Lookup?Phone=01001234567`, { Token: "tok-b" });
  expect(Other.Body.Data.map((C: any) => C.Name)).toEqual(["شركة ب"]);
  expect((await Call("GET", `/Customers/Lookup?Phone=12345`, { Token: "tok-a" })).Status).toBe(400);
});

test("new and edited customers cannot take a phone already used in the company", async () => {
  await Ready();
  const Dup = await Call("POST", "/Customers", { Token: "tok-a", Body: { Name: "جديد", Phone: "+201223334444" } });
  expect(Dup.Status).toBe(409);
  expect(Dup.Body.Error.Code).toBe("PHONE_TAKEN");
  const Fresh = await Call("POST", "/Customers", { Token: "tok-a", Body: { Name: "جديد", Phone: "0111 222 3333" } });
  expect(Fresh.Status).toBe(201);
  expect(Fresh.Body.Data.Phone).toBe("0111 222 3333");
  const [Row] = await Sql<{ PhoneNormalized: string }>(`SELECT "PhoneNormalized" FROM "Customers" WHERE "Id" = $1`, [Fresh.Body.Data.Id]);
  expect(Row.PhoneNormalized).toBe("+201112223333");
  expect((await Call("POST", "/Customers", { Token: "tok-b", Body: { Name: "ب", Phone: "01112223333" } })).Status).toBe(201);
  const Same = await Call("PATCH", `/Customers/${Fresh.Body.Data.Id}`, { Token: "tok-a", Body: { Phone: "01112223333" } });
  expect(Same.Status).toBe(200);
  const Second = await Call("POST", "/Customers", { Token: "tok-a", Body: { Name: "تاني", Phone: "01099999999" } });
  const Clash = await Call("PATCH", `/Customers/${Second.Body.Data.Id}`, { Token: "tok-a", Body: { Phone: "+20 111 222 3333" } });
  expect(Clash.Status).toBe(409);
  const Lookup = await Call("GET", `/Customers/Lookup?Phone=01099999999`, { Token: "tok-a" });
  expect(Lookup.Body.Data.map((C: any) => C.Name)).toEqual(["تاني"]);
});

test("numbers that are not Egyptian mobiles are still accepted as typed", async () => {
  await Ready();
  const Res = await Call("POST", "/Customers", { Token: "tok-a", Body: { Name: "أرضي", Phone: "0223456789" } });
  expect(Res.Status).toBe(201);
  const Again = await Call("POST", "/Customers", { Token: "tok-a", Body: { Name: "أرضي 2", Phone: "0223456789" } });
  expect(Again.Status).toBe(201);
  const [Row] = await Sql<{ PhoneNormalized: string | null }>(`SELECT "PhoneNormalized" FROM "Customers" WHERE "Id" = $1`, [Res.Body.Data.Id]);
  expect(Row.PhoneNormalized).toBeNull();
});
