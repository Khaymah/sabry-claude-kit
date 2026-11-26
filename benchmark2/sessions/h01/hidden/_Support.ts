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


export async function MigrateRest() {
  await Migrate(Client, {});
}

export async function NewProduct(CompanyId: number, Fields: { Name?: string; Sku?: string; Stock?: number } = {}) {
  ++Seq;
  const Name = Fields.Name ?? `Product ${Seq}`;
  const Sku = Fields.Sku ?? `SKU-${String(Seq).padStart(6, "0")}`;
  const Rows = Fields.Stock === undefined
    ? await Sql<{ Id: number }>(`INSERT INTO "Products" ("CompanyId","Name","Sku","Price") VALUES ($1,$2,$3,'100.00') RETURNING "Id"`, [CompanyId, Name, Sku])
    : await Sql<{ Id: number }>(`INSERT INTO "Products" ("CompanyId","Name","Sku","Price","Stock") VALUES ($1,$2,$3,'100.00',$4) RETURNING "Id"`, [CompanyId, Name, Sku, Fields.Stock]);
  return Rows[0].Id;
}

export const Created = (Status: number) => Status === 200 || Status === 201;

export function ListOf(Data: any): any[] {
  if (Array.isArray(Data)) return Data;
  if (Data && Array.isArray(Data.Items)) return Data.Items;
  return [];
}

export async function Warehouses(Token: string) {
  const Res = await Call("GET", "/Warehouses", { Token });
  return ListOf(Res.Body?.Data);
}

export async function NewWarehouse(Token: string, Name = `Branch ${++Seq}`) {
  const Res = await Call("POST", "/Warehouses", { Token, Body: { Name } });
  if (!Created(Res.Status)) throw new Error(`warehouse create failed ${Res.Status} ${Res.Text}`);
  return Res.Body.Data.Id as number;
}

export async function StockOf(Token: string, WarehouseId: number) {
  const Res = await Call("GET", `/Warehouses/${WarehouseId}/Stock`, { Token });
  const Found = new Map<number, number>();
  for (const I of ListOf(Res.Body?.Data)) Found.set(Number(I.ProductId), Number(I.Quantity));
  return { Status: Res.Status, Map: Found };
}

export async function Qty(Token: string, WarehouseId: number, ProductId: number) {
  return (await StockOf(Token, WarehouseId)).Map.get(ProductId) ?? 0;
}

export function Adjust(Token: string, WarehouseId: number, ProductId: number, Change: number, Reason = "تسوية") {
  return Call("POST", `/Warehouses/${WarehouseId}/Adjustments`, { Token, Body: { ProductId, Change, Reason } });
}

export async function Put(Token: string, WarehouseId: number, ProductId: number, Quantity: number) {
  const Res = await Adjust(Token, WarehouseId, ProductId, Quantity, "رصيد");
  if (!Created(Res.Status)) throw new Error(`adjust failed ${Res.Status} ${Res.Text}`);
}

export function Send(Token: string, FromWarehouseId: number, ToWarehouseId: number, Items: { ProductId: number; Quantity: number }[]) {
  return Call("POST", "/Transfers", { Token, Body: { FromWarehouseId, ToWarehouseId, Items } });
}

export async function SendOk(Token: string, From: number, To: number, Items: { ProductId: number; Quantity: number }[]) {
  const Res = await Send(Token, From, To, Items);
  if (!Created(Res.Status)) throw new Error(`transfer failed ${Res.Status} ${Res.Text}`);
  return Res.Body.Data.Id as number;
}

export const Receive = (Token: string, Id: number) => Call("POST", `/Transfers/${Id}/Receive`, { Token });
export const Cancel = (Token: string, Id: number) => Call("POST", `/Transfers/${Id}/Cancel`, { Token });
export const Stocktake = (Token: string, WarehouseId: number, Lines: unknown[]) =>
  Call("POST", `/Warehouses/${WarehouseId}/Stocktakes`, { Token, Body: { Lines } });

export async function Movements(Token: string, WarehouseId: number, ProductId: number) {
  const Res = await Call("GET", `/Warehouses/${WarehouseId}/Movements?ProductId=${ProductId}`, { Token });
  return { Status: Res.Status, Items: ListOf(Res.Body?.Data), Res };
}

export async function ReportPage(Token: string, Page = 1, PageSize = 100) {
  return Call("GET", `/Reports/StockByWarehouse?Page=${Page}&PageSize=${PageSize}`, { Token });
}

export async function ReportRow(Token: string, ProductId: number) {
  for (let Page = 1; Page <= 50; Page++) {
    const Res = await ReportPage(Token, Page, 100);
    const Items = ListOf(Res.Body?.Data);
    const Row = Items.find((I: any) => Number(I.ProductId) === ProductId);
    if (Row) return Row;
    if (Items.length < 100) break;
  }
  return undefined;
}

export function InBranch(Row: any, WarehouseId: number, Field = "Quantity") {
  const W = (Row?.Warehouses ?? []).find((X: any) => Number(X.WarehouseId) === WarehouseId);
  return W ? Number(W[Field] ?? 0) : 0;
}
