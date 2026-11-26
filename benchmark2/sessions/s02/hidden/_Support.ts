import { App } from "../../Src/App";
import { Client } from "../../Src/Database/Db";
import { Migrate } from "../../Src/Database/Migrations";

export async function Reset(UpTo?: string) {
  await Client.exec(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
  await Migrate(Client, UpTo ? { UpTo } : {});
}

export async function Sql<T = any>(Query: string, Params: unknown[] = []): Promise<T[]> {
  return (await Client.query<T>(Query, Params)).rows;
}

export type CallResult = { Status: number; Body: any; Text: string; Headers: Headers; Bytes: Uint8Array };

export async function Call(
  Method: string,
  Path: string,
  Options: { Token?: string; Body?: unknown; Headers?: Record<string, string>; RawBody?: BodyInit } = {},
): Promise<CallResult> {
  const Headers: Record<string, string> = { ...(Options.Headers ?? {}) };
  if (Options.Token) Headers.Authorization = `Bearer ${Options.Token}`;
  let Body: BodyInit | undefined = Options.RawBody;
  if (Options.Body !== undefined) {
    Body = JSON.stringify(Options.Body);
    Headers["Content-Type"] ??= "application/json";
  }
  const Res = await App.request(Path, { method: Method, headers: Headers, body: Body });
  const Bytes = new Uint8Array(await Res.arrayBuffer());
  const Text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(Bytes);
  let Parsed: any = null;
  try {
    Parsed = JSON.parse(Text);
  } catch {}
  return { Status: Res.status, Body: Parsed, Text, Headers: Res.headers, Bytes };
}

let Seq = 0;
const Hash = await Bun.password.hash("Password123!", { algorithm: "bcrypt", cost: 4 });
export const DefaultPassword = "Password123!";

export async function NewCompany(Name = `Company ${++Seq}`) {
  const [Company] = await Sql<{ Id: number }>(`INSERT INTO "Companies" ("Name") VALUES ($1) RETURNING "Id"`, [Name]);
  const Owner = await NewUser(Company.Id, "Owner");
  return { CompanyId: Company.Id, ...Owner };
}

export async function NewUser(CompanyId: number, Role = "Staff") {
  const Email = `u${++Seq}_${Math.random().toString(36).slice(2, 8)}@example.com`;
  const [User] = await Sql<{ Id: number }>(
    `INSERT INTO "Users" ("CompanyId","Email","Name","PasswordHash","Role") VALUES ($1,$2,$3,$4,$5) RETURNING "Id"`,
    [CompanyId, Email, `User ${Seq}`, Hash, Role],
  );
  const Token = `tok_${Seq}_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  await Sql(`INSERT INTO "Sessions" ("Token","UserId","ExpiresAt") VALUES ($1,$2, now() + interval '3650 days')`, [Token, User.Id]);
  return { UserId: User.Id, Email, Password: DefaultPassword, Token };
}

export async function NewCustomer(CompanyId: number, Fields: { Name?: string; Phone?: string | null; WalletBalance?: string } = {}) {
  const [Row] = await Sql<{ Id: number }>(
    `INSERT INTO "Customers" ("CompanyId","Name","Phone","WalletBalance") VALUES ($1,$2,$3,$4) RETURNING "Id"`,
    [CompanyId, Fields.Name ?? `Customer ${++Seq}`, Fields.Phone ?? null, Fields.WalletBalance ?? "0.00"],
  );
  return Row.Id;
}

export async function NewProduct(CompanyId: number, Fields: { Name?: string; Sku?: string; Price?: string; Stock?: number } = {}) {
  ++Seq;
  const [Row] = await Sql<{ Id: number }>(
    `INSERT INTO "Products" ("CompanyId","Name","Sku","Price","Stock") VALUES ($1,$2,$3,$4,$5) RETURNING "Id"`,
    [CompanyId, Fields.Name ?? `Product ${Seq}`, Fields.Sku ?? `SKU-${Seq}`, Fields.Price ?? "100.00", Fields.Stock ?? 100],
  );
  return Row.Id;
}

export async function NewOrder(CompanyId: number, CustomerId: number, Total = "114.00", Status = "Pending") {
  const Sub = (Math.round(Number(Total) * 100 / 1.14) / 100).toFixed(2);
  const Tax = (Number(Total) - Number(Sub)).toFixed(2);
  const [Row] = await Sql<{ Id: number }>(
    `INSERT INTO "Orders" ("CompanyId","CustomerId","Status","Subtotal","Tax","Total") VALUES ($1,$2,$3,$4,$5,$6) RETURNING "Id"`,
    [CompanyId, CustomerId, Status, Sub, Tax, Total],
  );
  return Row.Id;
}

export async function NewSupplier(CompanyId: number, Name = `Supplier ${Math.random().toString(36).slice(2, 7)}`) {
  const [Row] = await Sql<{ Id: number }>(`INSERT INTO "Suppliers" ("CompanyId","Name") VALUES ($1,$2) RETURNING "Id"`, [CompanyId, Name]);
  return Row.Id;
}

export async function NewPurchaseOrder(Token: string, SupplierId: number, Items: { ProductId: number; Quantity: number; UnitCost: string }[]) {
  const Res = await Call("POST", "/PurchaseOrders", { Token, Body: { SupplierId, Items } });
  if (Res.Status !== 201) throw new Error(`PO create failed: ${Res.Text}`);
  return Res.Body.Data.Id as number;
}

export async function StockOf(ProductId: number) {
  const [Row] = await Sql<{ Stock: number }>(`SELECT "Stock" FROM "Products" WHERE "Id" = $1`, [ProductId]);
  return Row.Stock;
}
