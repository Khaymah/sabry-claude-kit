import { beforeEach, expect, test } from "bun:test";
import { QueryStats } from "../../Src/Database/Db";
import { Call, NewCompany, Reset, Sql } from "./_Support";

let A: Awaited<ReturnType<typeof NewCompany>>;
let Supplier: number;

beforeEach(async () => {
  await Reset();
  A = await NewCompany();
  Supplier = await NewSupplier(A.CompanyId, "مورد النور");
});

async function NewSupplier(CompanyId: number, Name: string) {
  const [Row] = await Sql<{ Id: number }>(`INSERT INTO "Suppliers" ("CompanyId","Name") VALUES ($1,$2) RETURNING "Id"`, [CompanyId, Name]);
  return Row.Id;
}

async function Po(CompanyId: number, SupplierId: number, Total: string, Status = "Received", At = "2026-03-01T10:00:00Z") {
  const [Row] = await Sql<{ Id: number }>(
    `INSERT INTO "PurchaseOrders" ("CompanyId","SupplierId","Status","Total","ReceivedAt") VALUES ($1,$2,$3,$4,$5) RETURNING "Id"`,
    [CompanyId, SupplierId, Status, Total, Status === "Received" ? At : null],
  );
  return Row.Id;
}

const PaySupplier = (Id: number, Amount: unknown, Token = A.Token) => Call("POST", `/Suppliers/${Id}/Payments`, { Token, Body: { Amount, Method: "BankTransfer" } });
const Statement = (Id: number, Token = A.Token) => Call("GET", `/Suppliers/${Id}/Statement`, { Token });

test("the statement adds received purchases and payments to the piaster", async () => {
  await Po(A.CompanyId, Supplier, "33.33");
  await Po(A.CompanyId, Supplier, "33.33");
  await Po(A.CompanyId, Supplier, "33.34");
  await Po(A.CompanyId, Supplier, "50.00", "Draft");
  const Other = await NewSupplier(A.CompanyId, "مورد تاني");
  await Po(A.CompanyId, Other, "999.00");
  expect((await PaySupplier(Supplier, "10.10")).Status).toBe(201);
  expect((await PaySupplier(Supplier, "20.20")).Status).toBe(201);
  expect((await PaySupplier(Other, "5.00")).Status).toBe(201);
  const Res = await Statement(Supplier);
  expect(Res.Status).toBe(200);
  expect(Res.Body.Data).toMatchObject({ TotalPurchases: "100.00", TotalPaid: "30.30", Balance: "69.70" });
  expect(Res.Body.Data.Entries.length).toBe(5);
  expect(Res.Body.Data.Entries.filter((E: any) => E.Type === "Payment").map((E: any) => E.Amount).sort()).toEqual(["10.10", "20.20"]);
});

test("entries come in date order", async () => {
  await Po(A.CompanyId, Supplier, "10.00", "Received", "2026-03-05T10:00:00Z");
  await Po(A.CompanyId, Supplier, "20.00", "Received", "2026-03-01T10:00:00Z");
  await PaySupplier(Supplier, "5.00");
  const Entries = (await Statement(Supplier)).Body.Data.Entries;
  const Times = Entries.map((E: any) => new Date(E.Date).getTime());
  expect([...Times].sort((X, Y) => X - Y)).toEqual(Times);
  expect(Entries[0].Amount).toBe("20.00");
});

test("another company cannot pay or read a supplier", async () => {
  await Po(A.CompanyId, Supplier, "40.00");
  const B = await NewCompany();
  expect((await PaySupplier(Supplier, "1.00", B.Token)).Status).toBe(404);
  expect((await Statement(Supplier, B.Token)).Status).toBe(404);
  const Res = await Statement(Supplier);
  expect(Res.Body.Data.TotalPaid).toBe("0.00");
});

test("payment amounts are validated", async () => {
  for (const Bad of ["0", "0.00", "-5", "1.001", "abc", null]) expect((await PaySupplier(Supplier, Bad)).Status).toBe(400);
  expect((await Statement(Supplier)).Body.Data.Entries.length).toBe(0);
});

test("a long statement is built with a constant number of queries", async () => {
  await Sql(
    `INSERT INTO "PurchaseOrders" ("CompanyId","SupplierId","Status","Total","ReceivedAt")
     SELECT $1, $2, 'Received', ((g % 97) + 1)::numeric / 10, timestamptz '2026-01-01' + g * interval '1 hour' FROM generate_series(1, 400) g`,
    [A.CompanyId, Supplier],
  );
  for (let I = 0; I < 3; I++) await PaySupplier(Supplier, "0.10");
  QueryStats.Reset();
  const Res = await Statement(Supplier);
  expect(Res.Status).toBe(200);
  expect(QueryStats.Count).toBeLessThanOrEqual(6);
  expect(Res.Body.Data.Entries.length).toBe(403);
  const [Truth] = await Sql<{ T: string }>(`SELECT sum("Total")::numeric(12,2)::text AS "T" FROM "PurchaseOrders" WHERE "SupplierId" = $1`, [Supplier]);
  expect(Res.Body.Data.TotalPurchases).toBe(Truth.T);
  expect(Res.Body.Data.TotalPaid).toBe("0.30");
});
