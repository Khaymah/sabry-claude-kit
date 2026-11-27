import { beforeEach, expect, test } from "bun:test";
import { Client } from "../../Src/Database/Db";
import { Migrate } from "../../Src/Database/Migrations";
import { Call, NewCompany, NewCustomer, NewProduct, Reset, Sql } from "./_Support";

async function Numbers(CompanyId: number) {
  return (await Sql<{ OrderNumber: number }>(`SELECT "OrderNumber" FROM "Orders" WHERE "CompanyId" = $1 ORDER BY "OrderNumber"`, [CompanyId])).map((R) => R.OrderNumber);
}

async function Place(Token: string, CustomerId: number, ProductId: number, Quantity = 1) {
  return Call("POST", "/Orders", { Token, Body: { CustomerId, Items: [{ ProductId, Quantity }] } });
}

test("existing orders are numbered per company by creation time", async () => {
  await Reset("0001_Init");
  const [A] = await Sql<{ Id: number }>(`INSERT INTO "Companies" ("Name") VALUES ('A') RETURNING "Id"`);
  const [B] = await Sql<{ Id: number }>(`INSERT INTO "Companies" ("Name") VALUES ('B') RETURNING "Id"`);
  const [CA] = await Sql<{ Id: number }>(`INSERT INTO "Customers" ("CompanyId","Name") VALUES ($1,'a') RETURNING "Id"`, [A.Id]);
  const [CB] = await Sql<{ Id: number }>(`INSERT INTO "Customers" ("CompanyId","Name") VALUES ($1,'b') RETURNING "Id"`, [B.Id]);
  const Plan: [number, number, string][] = [
    [A.Id, CA.Id, "2025-03-01T10:00:00Z"],
    [B.Id, CB.Id, "2025-01-01T10:00:00Z"],
    [A.Id, CA.Id, "2025-01-15T10:00:00Z"],
    [A.Id, CA.Id, "2025-02-01T10:00:00Z"],
    [B.Id, CB.Id, "2025-02-01T10:00:00Z"],
    [A.Id, CA.Id, "2025-02-01T10:00:00Z"],
  ];
  const Ids: number[] = [];
  for (const [Company, Customer, At] of Plan) {
    const [Row] = await Sql<{ Id: number }>(
      `INSERT INTO "Orders" ("CompanyId","CustomerId","Status","Subtotal","Tax","Total","CreatedAt") VALUES ($1,$2,'Paid','1','0','1',$3) RETURNING "Id"`,
      [Company, Customer, At],
    );
    Ids.push(Row.Id);
  }
  await Migrate(Client);
  const Got = await Sql<{ Id: number; OrderNumber: number }>(`SELECT "Id", "OrderNumber" FROM "Orders" ORDER BY "Id"`);
  expect(Got.map((R) => R.OrderNumber)).toEqual([4, 1, 1, 2, 2, 3]);
  await Migrate(Client);
});

let A: Awaited<ReturnType<typeof NewCompany>>;
let B: Awaited<ReturnType<typeof NewCompany>>;

async function Fresh() {
  await Reset();
  A = await NewCompany();
  B = await NewCompany();
  return {
    CA: await NewCustomer(A.CompanyId),
    PA: await NewProduct(A.CompanyId, { Stock: 1000 }),
    CB: await NewCustomer(B.CompanyId),
    PB: await NewProduct(B.CompanyId, { Stock: 1000 }),
  };
}

test("new orders continue the sequence and show their number", async () => {
  const { CA, PA } = await Fresh();
  const First = await Place(A.Token, CA, PA);
  const Second = await Place(A.Token, CA, PA);
  expect(First.Body.Data.OrderNumber).toBe(1);
  expect(Second.Body.Data.OrderNumber).toBe(2);
  const Fetched = await Call("GET", `/Orders/${Second.Body.Data.Id}`, { Token: A.Token });
  expect(Fetched.Body.Data.OrderNumber).toBe(2);
  const Listed = await Call("GET", "/Orders", { Token: A.Token });
  expect(Listed.Body.Data.Items.map((O: any) => O.OrderNumber).sort()).toEqual([1, 2]);
});

test("simultaneous orders get distinct consecutive numbers per company", async () => {
  const { CA, PA, CB, PB } = await Fresh();
  const Results = await Promise.all([
    ...Array.from({ length: 15 }, () => Place(A.Token, CA, PA)),
    ...Array.from({ length: 10 }, () => Place(B.Token, CB, PB)),
  ]);
  expect(Results.every((R) => R.Status === 201)).toBe(true);
  expect(await Numbers(A.CompanyId)).toEqual(Array.from({ length: 15 }, (_, I) => I + 1));
  expect(await Numbers(B.CompanyId)).toEqual(Array.from({ length: 10 }, (_, I) => I + 1));
});

test("failed orders do not burn numbers; cancelled orders keep theirs", async () => {
  const { CA, PA } = await Fresh();
  const Scarce = await NewProduct(A.CompanyId, { Stock: 1 });
  expect((await Place(A.Token, CA, PA)).Body.Data.OrderNumber).toBe(1);
  const Failed = await Place(A.Token, CA, Scarce, 5);
  expect(Failed.Status).toBe(409);
  const Burst = await Promise.all(Array.from({ length: 4 }, () => Place(A.Token, CA, Scarce)));
  expect(Burst.filter((R) => R.Status === 201).length).toBe(1);
  const Third = await Place(A.Token, CA, PA);
  expect(Third.Body.Data.OrderNumber).toBe(3);
  expect((await Call("POST", `/Orders/${Third.Body.Data.Id}/Cancel`, { Token: A.Token })).Status).toBe(200);
  expect((await Place(A.Token, CA, PA)).Body.Data.OrderNumber).toBe(4);
  expect(await Numbers(A.CompanyId)).toEqual([1, 2, 3, 4]);
});

test("orders can be fetched by number within the company only", async () => {
  const { CA, PA, CB, PB } = await Fresh();
  const Mine = await Place(A.Token, CA, PA);
  await Place(A.Token, CA, PA);
  const Theirs = await Place(B.Token, CB, PB);
  const Res = await Call("GET", "/Orders/ByNumber/1", { Token: A.Token });
  expect(Res.Status).toBe(200);
  expect(Res.Body.Data.Id).toBe(Mine.Body.Data.Id);
  const Other = await Call("GET", "/Orders/ByNumber/1", { Token: B.Token });
  expect(Other.Body.Data.Id).toBe(Theirs.Body.Data.Id);
  expect((await Call("GET", "/Orders/ByNumber/2", { Token: B.Token })).Status).toBe(404);
});

test("numbering continues after the backfill", async () => {
  await Reset("0001_Init");
  const [Co] = await Sql<{ Id: number }>(`INSERT INTO "Companies" ("Name") VALUES ('Old') RETURNING "Id"`);
  const [Cu] = await Sql<{ Id: number }>(`INSERT INTO "Customers" ("CompanyId","Name") VALUES ($1,'c') RETURNING "Id"`, [Co.Id]);
  await Sql(`INSERT INTO "Orders" ("CompanyId","CustomerId","Status","Subtotal","Tax","Total") SELECT $1,$2,'Paid','1','0','1' FROM generate_series(1,7)`, [Co.Id, Cu.Id]);
  await Migrate(Client);
  const [U] = await Sql<{ Id: number }>(`INSERT INTO "Users" ("CompanyId","Email","Name","PasswordHash","Role") VALUES ($1,'o@example.com','O','x','Owner') RETURNING "Id"`, [Co.Id]);
  await Sql(`INSERT INTO "Sessions" ("Token","UserId","ExpiresAt") VALUES ('tok-old',$1, now() + interval '1 day')`, [U.Id]);
  const P = await NewProduct(Co.Id);
  const Res = await Place("tok-old", Cu.Id, P);
  expect(Res.Status).toBe(201);
  expect(Res.Body.Data.OrderNumber).toBe(8);
});
