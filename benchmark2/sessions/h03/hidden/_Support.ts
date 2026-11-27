import { expect } from "bun:test";
import { App } from "../../Src/App";
import { Client } from "../../Src/Database/Db";
import { Migrate } from "../../Src/Database/Migrations";

export async function Sql<T = any>(Query: string, Params: unknown[] = []): Promise<T[]> {
  return (await Client.query<T>(Query, Params)).rows;
}

export type CallResult = { Status: number; Body: any; Text: string };

export async function Call(Method: string, Path: string, Options: { Token?: string; Body?: unknown } = {}): Promise<CallResult> {
  const Headers: Record<string, string> = {};
  if (Options.Token) Headers.Authorization = `Bearer ${Options.Token}`;
  let Body: BodyInit | undefined;
  if (Options.Body !== undefined) {
    Body = JSON.stringify(Options.Body);
    Headers["Content-Type"] = "application/json";
  }
  const Res = await App.request(Path, { method: Method, headers: Headers, body: Body });
  const Text = await Res.text();
  let Parsed: any = null;
  try {
    Parsed = JSON.parse(Text);
  } catch {}
  return { Status: Res.status, Body: Parsed, Text };
}

let Seq = 0;
export const Password = "Password123!";
const Hash = await Bun.password.hash(Password, { algorithm: "bcrypt", cost: 4 });
const Uniq = () => `${++Seq}_${Math.random().toString(36).slice(2, 8)}`;

async function LegacyUser(CompanyId: number, Role: string) {
  const Email = `legacy${Uniq()}@example.com`;
  const [User] = await Sql<{ Id: number }>(
    `INSERT INTO "Users" ("CompanyId","Email","Name","PasswordHash","Role") VALUES ($1,$2,$3,$4,$5) RETURNING "Id"`,
    [CompanyId, Email, `Legacy ${Role} ${Seq}`, Hash, Role],
  );
  const Token = `tok_${Uniq()}${Math.random().toString(36).slice(2)}`;
  await Sql(`INSERT INTO "Sessions" ("Token","UserId","ExpiresAt") VALUES ($1,$2, now() + interval '3650 days')`, [Token, User.Id]);
  return { UserId: User.Id, Email, Token };
}

async function LegacyCompany(Name: string) {
  const [Company] = await Sql<{ Id: number }>(`INSERT INTO "Companies" ("Name") VALUES ($1) RETURNING "Id"`, [Name]);
  const Owner = await LegacyUser(Company.Id, "Owner");
  const Staff = await LegacyUser(Company.Id, "Staff");
  const [Customer] = await Sql<{ Id: number }>(`INSERT INTO "Customers" ("CompanyId","Name") VALUES ($1,$2) RETURNING "Id"`, [Company.Id, `Customer of ${Name}`]);
  const [Product] = await Sql<{ Id: number }>(
    `INSERT INTO "Products" ("CompanyId","Name","Sku","Price","Stock") VALUES ($1,$2,$3,'100.00',100000) RETURNING "Id"`,
    [Company.Id, `Product of ${Name}`, `SKU-${Uniq()}`],
  );
  const [Order] = await Sql<{ Id: number }>(
    `INSERT INTO "Orders" ("CompanyId","CustomerId","Status","Subtotal","Tax","Total","CreatedAt") VALUES ($1,$2,'Pending','100.00','14.00','114.00','2026-03-10T12:00:00Z') RETURNING "Id"`,
    [Company.Id, Customer.Id],
  );
  const [Expense] = await Sql<{ Id: number }>(
    `INSERT INTO "Expenses" ("CompanyId","Category","Amount","SpentOn") VALUES ($1,'Rent','40.00','2026-03-11') RETURNING "Id"`,
    [Company.Id],
  );
  return { CompanyId: Company.Id, Owner, Staff, CustomerId: Customer.Id, ProductId: Product.Id, LegacyOrderId: Order.Id, LegacyExpenseId: Expense.Id };
}

export type Shop = Awaited<ReturnType<typeof LegacyCompany>>;

export async function World() {
  await Client.exec(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
  await Migrate(Client, { UpTo: "0001_Init" });
  const A = await LegacyCompany(`Shop A ${Uniq()}`);
  const B = await LegacyCompany(`Shop B ${Uniq()}`);
  await Migrate(Client);
  return { A, B };
}

export const List = (Body: any): any[] => {
  const D = Body?.Data;
  if (Array.isArray(D)) return D;
  if (Array.isArray(D?.Items)) return D.Items;
  return [];
};

export async function Branches(Token: string) {
  const Res = await Call("GET", "/Branches", { Token });
  expect(Res.Status).toBe(200);
  return List(Res.Body);
}

export async function MainBranch(Token: string): Promise<number> {
  const Main = (await Branches(Token)).filter((B: any) => B.IsMain === true);
  expect(Main.length).toBe(1);
  return Main[0].Id;
}

export async function NewBranch(Token: string, Name = `Branch ${Uniq()}`): Promise<number> {
  const Res = await Call("POST", "/Branches", { Token, Body: { Name } });
  expect([200, 201]).toContain(Res.Status);
  return Res.Body.Data.Id;
}

export async function Login(Email: string) {
  const Res = await Call("POST", "/Auth/Login", { Body: { Email, Password } });
  return { Status: Res.Status, Token: Res.Body?.Data?.Token as string };
}

export async function AddUser(Token: string, Role: string, BranchId?: number) {
  const Email = `user${Uniq()}@example.com`;
  const Body: Record<string, unknown> = { Email, Name: `${Role} ${Seq}`, Password, Role };
  if (BranchId !== undefined) Body.BranchId = BranchId;
  return { Email, Res: await Call("POST", "/Users", { Token, Body }) };
}

export async function NewMember(Token: string, Role: string, BranchId?: number) {
  const { Email, Res } = await AddUser(Token, Role, BranchId);
  expect(Res.Status).toBe(201);
  const Session = await Login(Email);
  expect(Session.Status).toBe(200);
  return { UserId: Res.Body.Data.Id as number, Email, Token: Session.Token };
}

export async function Users(Token: string) {
  const Res = await Call("GET", "/Users", { Token });
  expect(Res.Status).toBe(200);
  return List(Res.Body);
}

export async function UserRow(OwnerToken: string, UserId: number) {
  return (await Users(OwnerToken)).find((U: any) => U.Id === UserId);
}

export async function UserCountByEmail(Email: string) {
  const [Row] = await Sql<{ N: number }>(`SELECT count(*)::int AS "N" FROM "Users" WHERE "Email" = $1`, [Email]);
  return Row.N;
}

export async function PlaceOrder(Token: string, Shop: Shop, BranchId?: number, Quantity = 1) {
  const Body: Record<string, unknown> = { CustomerId: Shop.CustomerId, Items: [{ ProductId: Shop.ProductId, Quantity }] };
  if (BranchId !== undefined) Body.BranchId = BranchId;
  return Call("POST", "/Orders", { Token, Body });
}

export async function NewOrder(Token: string, Shop: Shop, BranchId?: number, Quantity = 1): Promise<number> {
  const Res = await PlaceOrder(Token, Shop, BranchId, Quantity);
  expect(Res.Status).toBe(201);
  return Res.Body.Data.Id;
}

export async function AddExpense(Token: string, Amount: string, SpentOn: string, BranchId?: number) {
  const Body: Record<string, unknown> = { Category: "Supplies", Amount, SpentOn };
  if (BranchId !== undefined) Body.BranchId = BranchId;
  return Call("POST", "/Expenses", { Token, Body });
}

export async function NewExpense(Token: string, Amount: string, SpentOn: string, BranchId?: number): Promise<number> {
  const Res = await AddExpense(Token, Amount, SpentOn, BranchId);
  expect(Res.Status).toBe(201);
  return Res.Body.Data.Id;
}

export async function OrderIds(Token: string): Promise<number[]> {
  const Res = await Call("GET", "/Orders?Page=1&PageSize=100", { Token });
  expect(Res.Status).toBe(200);
  return List(Res.Body).map((O: any) => O.Id);
}

export async function OrderBranch(OwnerToken: string, OrderId: number) {
  const Res = await Call("GET", `/Orders/${OrderId}`, { Token: OwnerToken });
  expect(Res.Status).toBe(200);
  return Res.Body.Data.BranchId;
}

export async function OrderStatus(OrderId: number) {
  const [Row] = await Sql<{ Status: string }>(`SELECT "Status" FROM "Orders" WHERE "Id" = $1`, [OrderId]);
  return Row.Status;
}

export async function SetOrderDate(OrderId: number, Iso: string) {
  await Sql(`UPDATE "Orders" SET "CreatedAt" = $2 WHERE "Id" = $1`, [OrderId, Iso]);
}

export async function Transfer(Token: string, UserId: number, BranchId: number) {
  return Call("POST", `/Users/${UserId}/Transfer`, { Token, Body: { BranchId } });
}

export async function Transfers(Token: string, UserId: number) {
  const Res = await Call("GET", `/Users/${UserId}/Transfers`, { Token });
  expect(Res.Status).toBe(200);
  return List(Res.Body);
}

export async function Audit(Token: string, Query = "") {
  return Call("GET", `/AuditLogs?Page=1&PageSize=100${Query}`, { Token });
}

export async function AuditItems(Token: string, Query = "") {
  const Res = await Audit(Token, Query);
  expect(Res.Status).toBe(200);
  return List(Res.Body);
}

export const Huge = 99999999999;
export const Ok2xx = [200, 201];
