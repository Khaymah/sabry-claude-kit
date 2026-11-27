import { spyOn } from "bun:test";
import { App } from "../../Src/App";
import { Client } from "../../Src/Database/Db";
import { Migrate } from "../../Src/Database/Migrations";
import * as Clock from "../../Src/Lib/Clock";

export async function Reset(UpTo?: string) {
  await Client.exec(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
  await Migrate(Client, UpTo ? { UpTo } : {});
}

export async function MigrateRest() {
  await Migrate(Client, {});
}

export async function Sql<T = any>(Query: string, Params: unknown[] = []): Promise<T[]> {
  return (await Client.query<T>(Query, Params)).rows;
}

export type CallResult = { Status: number; Body: any; Text: string; Headers: Headers };

export async function Call(
  Method: string,
  Path: string,
  Options: { Token?: string; Body?: unknown; Headers?: Record<string, string> } = {},
): Promise<CallResult> {
  const Headers: Record<string, string> = { ...(Options.Headers ?? {}) };
  if (Options.Token) Headers.Authorization = `Bearer ${Options.Token}`;
  let Body: BodyInit | undefined;
  if (Options.Body !== undefined) {
    Body = JSON.stringify(Options.Body);
    Headers["Content-Type"] ??= "application/json";
  }
  const Res = await App.request(Path, { method: Method, headers: Headers, body: Body });
  const Text = await Res.text();
  let Parsed: any = null;
  try {
    Parsed = JSON.parse(Text);
  } catch {}
  return { Status: Res.status, Body: Parsed, Text, Headers: Res.headers };
}

let Seq = 0;
const Hash = await Bun.password.hash("Password123!", { algorithm: "bcrypt", cost: 4 });

export async function NewCompany(Name = `Company ${++Seq}`) {
  const [Company] = await Sql<{ Id: number }>(`INSERT INTO "Companies" ("Name") VALUES ($1) RETURNING "Id"`, [Name]);
  const Owner = await NewUser(Company.Id, "Owner");
  return { CompanyId: Company.Id, ...Owner };
}

export async function NewUser(CompanyId: number, Role = "Staff") {
  const Email = `u${++Seq}_${Math.random().toString(36).slice(2, 8)}@example.com`;
  const Name = `User ${Seq}`;
  const [User] = await Sql<{ Id: number }>(
    `INSERT INTO "Users" ("CompanyId","Email","Name","PasswordHash","Role") VALUES ($1,$2,$3,$4,$5) RETURNING "Id"`,
    [CompanyId, Email, Name, Hash, Role],
  );
  const Token = `tok_${Seq}_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  await Sql(`INSERT INTO "Sessions" ("Token","UserId","ExpiresAt") VALUES ($1,$2, now() + interval '3650 days')`, [Token, User.Id]);
  return { UserId: User.Id, Name, Token };
}

export async function NewProduct(CompanyId: number, Fields: { Price?: string; Stock?: number; Name?: string } = {}) {
  ++Seq;
  const [Row] = await Sql<{ Id: number }>(
    `INSERT INTO "Products" ("CompanyId","Name","Sku","Price","Stock") VALUES ($1,$2,$3,$4,$5) RETURNING "Id"`,
    [CompanyId, Fields.Name ?? `Product ${Seq}`, `SKU-${String(Seq).padStart(6, "0")}`, Fields.Price ?? "100.00", Fields.Stock ?? 1000],
  );
  return Row.Id;
}

export async function NewCustomer(Token: string, Name = `Customer ${++Seq}`) {
  const Res = await Call("POST", "/Customers", { Token, Body: { Name } });
  if (!Created(Res.Status)) throw new Error(`customer create failed ${Res.Status} ${Res.Text}`);
  return Res.Body.Data.Id as number;
}

export const Created = (Status: number) => Status === 200 || Status === 201;

export function ListOf(Data: any): any[] {
  if (Array.isArray(Data)) return Data;
  if (Data && Array.isArray(Data.Items)) return Data.Items;
  return [];
}

export const Money = (Value: unknown) => Number(Value).toFixed(2);

export function Day(Offset = 0) {
  const D = new Date();
  D.setUTCHours(12, 0, 0, 0);
  D.setUTCDate(D.getUTCDate() + Offset);
  return D.toISOString().slice(0, 10);
}

let ClockSpy: ReturnType<typeof spyOn> | undefined;

export function SetClock(DaysFromToday: number) {
  const D = new Date();
  D.setUTCHours(12, 0, 0, 0);
  D.setUTCDate(D.getUTCDate() + DaysFromToday);
  ClockSpy?.mockRestore();
  ClockSpy = spyOn(Clock, "Now").mockImplementation(() => new Date(D.getTime()));
}

export function RestoreClock() {
  ClockSpy?.mockRestore();
  ClockSpy = undefined;
}

export type Line = { ProductId: number; Quantity: number; DiscountPercent?: number };

export function PriceList(Token: string, CustomerId: number, ValidFrom: string, ValidTo: string | undefined, Items: { ProductId: number; Price: unknown }[]) {
  const Body: Record<string, unknown> = { CustomerId, ValidFrom, Items };
  if (ValidTo !== undefined) Body.ValidTo = ValidTo;
  return Call("POST", "/PriceLists", { Token, Body });
}

export async function PriceListOk(Token: string, CustomerId: number, ValidFrom: string, ValidTo: string | undefined, Items: { ProductId: number; Price: unknown }[]) {
  const Res = await PriceList(Token, CustomerId, ValidFrom, ValidTo, Items);
  if (!Created(Res.Status)) throw new Error(`price list failed ${Res.Status} ${Res.Text}`);
  return Res.Body.Data.Id as number;
}

export async function Prices(Token: string, CustomerId: number, Date?: string) {
  const Res = await Call("GET", `/Customers/${CustomerId}/Prices${Date ? `?Date=${Date}` : ""}`, { Token });
  const Map_ = new Map<number, string>();
  for (const I of ListOf(Res.Body?.Data)) Map_.set(Number(I.ProductId), Money(I.Price));
  return { Status: Res.Status, Map: Map_, Res };
}

export const NewQuote = (Token: string, CustomerId: number, Items: Line[]) => Call("POST", "/Quotes", { Token, Body: { CustomerId, Items } });

export async function QuoteOk(Token: string, CustomerId: number, Items: Line[]) {
  const Res = await NewQuote(Token, CustomerId, Items);
  if (!Created(Res.Status)) throw new Error(`quote failed ${Res.Status} ${Res.Text}`);
  return Res.Body.Data.Id as number;
}

export const GetQuote = (Token: string, Id: number) => Call("GET", `/Quotes/${Id}`, { Token });
export const StatusOf = async (Token: string, Id: number) => (await GetQuote(Token, Id)).Body?.Data?.Status;
export const Revise = (Token: string, Id: number, Items: Line[]) => Call("PUT", `/Quotes/${Id}`, { Token, Body: { Items } });
export const Versions = async (Token: string, Id: number) => {
  const Res = await Call("GET", `/Quotes/${Id}/Versions`, { Token });
  return { Status: Res.Status, Items: ListOf(Res.Body?.Data) };
};
export const Submit = (Token: string, Id: number) => Call("POST", `/Quotes/${Id}/Submit`, { Token });
export const Approve = (Token: string, Id: number) => Call("POST", `/Quotes/${Id}/Approve`, { Token });
export const Convert = (Token: string, Id: number) => Call("POST", `/Quotes/${Id}/Convert`, { Token });

export async function SubmitOk(Token: string, Id: number) {
  const Res = await Submit(Token, Id);
  if (!Created(Res.Status)) throw new Error(`submit failed ${Res.Status} ${Res.Text}`);
  return Res.Body.Data.Status as string;
}

export async function ApprovedQuote(Token: string, CustomerId: number, Items: Line[]) {
  const Id = await QuoteOk(Token, CustomerId, Items);
  const Status = await SubmitOk(Token, Id);
  if (Status !== "Approved") throw new Error(`expected auto approval, got ${Status}`);
  return Id;
}

export async function ConvertOk(Token: string, Id: number) {
  const Res = await Convert(Token, Id);
  if (!Created(Res.Status)) throw new Error(`convert failed ${Res.Status} ${Res.Text}`);
  return Number(Res.Body.Data.OrderId);
}

export async function StockOf(Token: string, ProductId: number) {
  const Res = await Call("GET", `/Products/${ProductId}`, { Token });
  return Number(Res.Body.Data.Stock);
}

export async function OrdersCount(Token: string) {
  const Res = await Call("GET", "/Orders?PageSize=100", { Token });
  return Number(Res.Body.Data.Total);
}
