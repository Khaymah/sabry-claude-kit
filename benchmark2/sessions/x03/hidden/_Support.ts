import { setSystemTime } from "bun:test";
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

export const Created = (Status: number) => Status === 200 || Status === 201;
export const Huge = 99999999999;

export function At(Iso: string) {
  setSystemTime(new Date(Iso));
}

export function ListOf(Data: any): any[] {
  if (Array.isArray(Data)) return Data;
  if (Data && Array.isArray(Data.Items)) return Data.Items;
  return [];
}

export function Money(Value: unknown): number {
  return Math.round(Number(Value) * 100);
}

export async function NewCustomer(CompanyId: number, Phone: string | null = null, Name = `Customer ${++Seq}`) {
  const [Row] = await Sql<{ Id: number }>(`INSERT INTO "Customers" ("CompanyId","Name","Phone") VALUES ($1,$2,$3) RETURNING "Id"`, [CompanyId, Name, Phone]);
  return Row.Id;
}

export async function NewOrganizer(Token: string, Name = `Organizer ${++Seq}`) {
  const Res = await Call("POST", "/Organizers", { Token, Body: { Name } });
  if (!Created(Res.Status)) throw new Error(`organizer create failed ${Res.Status} ${Res.Text}`);
  return Res.Body.Data.Id as number;
}

export type Category = { Name: string; Price: string; Capacity: number };

export function CreateEvent(Token: string, OrganizerId: number, Sessions: string[], Categories: Category[], Name = `Event ${++Seq}`) {
  return Call("POST", "/Events", { Token, Body: { OrganizerId, Name, Sessions: Sessions.map((StartsAt) => ({ StartsAt })), Categories } });
}

export async function NewEvent(Token: string, OrganizerId: number, Sessions: string[], Categories: Category[]) {
  const Res = await CreateEvent(Token, OrganizerId, Sessions, Categories);
  if (!Created(Res.Status)) throw new Error(`event create failed ${Res.Status} ${Res.Text}`);
  const Data = Res.Body.Data;
  const SessionIds = Sessions.map((Iso) => {
    const Found = (Data.Sessions ?? []).find((S: any) => new Date(S.StartsAt).getTime() === new Date(Iso).getTime());
    if (!Found) throw new Error(`session ${Iso} missing in ${Res.Text}`);
    return Found.Id as number;
  });
  const CategoryIds = Categories.map((C) => {
    const Found = (Data.Categories ?? []).find((X: any) => X.Name === C.Name);
    if (!Found) throw new Error(`category ${C.Name} missing in ${Res.Text}`);
    return Found.Id as number;
  });
  return { Id: Data.Id as number, Sessions: SessionIds, Categories: CategoryIds };
}

export async function Available(Token: string, EventId: number, SessionId: number, CategoryId: number) {
  const Res = await Call("GET", `/Events/${EventId}/Availability`, { Token });
  if (Res.Status !== 200) throw new Error(`availability failed ${Res.Status} ${Res.Text}`);
  const Row = ListOf(Res.Body.Data).find((I: any) => Number(I.SessionId) === SessionId && Number(I.CategoryId) === CategoryId);
  if (!Row) throw new Error(`availability row missing ${Res.Text}`);
  return Number(Row.Available);
}

export function Hold(Token: string, SessionId: number, CategoryId: number, CustomerId: number, Quantity: number) {
  return Call("POST", "/Holds", { Token, Body: { SessionId, CategoryId, CustomerId, Quantity } });
}

export async function HoldOk(Token: string, SessionId: number, CategoryId: number, CustomerId: number, Quantity: number) {
  const Res = await Hold(Token, SessionId, CategoryId, CustomerId, Quantity);
  if (!Created(Res.Status)) throw new Error(`hold failed ${Res.Status} ${Res.Text}`);
  return Res.Body.Data.Id as number;
}

export function PurchaseHold(Token: string, HoldId: number, PromoCode?: string) {
  return Call("POST", `/Holds/${HoldId}/Purchase`, { Token, Body: PromoCode === undefined ? {} : { PromoCode } });
}

export function NewPromo(Token: string, EventId: number, Code: string, PercentOff: unknown) {
  return Call("POST", `/Events/${EventId}/Promos`, { Token, Body: { Code, PercentOff } });
}

export async function PromoOk(Token: string, EventId: number, Code: string, PercentOff: number) {
  const Res = await NewPromo(Token, EventId, Code, PercentOff);
  if (!Created(Res.Status)) throw new Error(`promo failed ${Res.Status} ${Res.Text}`);
}

export function Buy(Token: string, SessionId: number, CategoryId: number, CustomerId: number, Quantity: unknown, PromoCode?: string) {
  const Body: Record<string, unknown> = { SessionId, CategoryId, CustomerId, Quantity };
  if (PromoCode !== undefined) Body.PromoCode = PromoCode;
  return Call("POST", "/Purchases", { Token, Body });
}

export async function BuyOk(Token: string, SessionId: number, CategoryId: number, CustomerId: number, Quantity: number, PromoCode?: string) {
  const Res = await Buy(Token, SessionId, CategoryId, CustomerId, Quantity, PromoCode);
  if (!Created(Res.Status)) throw new Error(`purchase failed ${Res.Status} ${Res.Text}`);
  return Res.Body.Data;
}

export function Group(Token: string, CustomerId: number, Lines: unknown[], PromoCode?: string) {
  const Body: Record<string, unknown> = { CustomerId, Lines };
  if (PromoCode !== undefined) Body.PromoCode = PromoCode;
  return Call("POST", "/GroupBookings", { Token, Body });
}

export const GetTicket = (Token: string, Id: number) => Call("GET", `/Tickets/${Id}`, { Token });
export const CheckIn = (Token: string, SessionId: number, Code: string) => Call("POST", `/Sessions/${SessionId}/CheckIn`, { Token, Body: { Code } });
export const Refund = (Token: string, TicketId: number) => Call("POST", `/Tickets/${TicketId}/Refund`, { Token });
export const CancelEvent = (Token: string, EventId: number) => Call("POST", `/Events/${EventId}/Cancel`, { Token });
export const Transfer = (Token: string, TicketId: number, Name: string, Phone: string) =>
  Call("POST", `/Tickets/${TicketId}/Transfer`, { Token, Body: { Name, Phone } });
export const Payout = (Token: string, OrganizerId: number, From: string, To: string) =>
  Call("GET", `/Organizers/${OrganizerId}/Payout?From=${From}&To=${To}`, { Token });

export async function PayoutOk(Token: string, OrganizerId: number, From: string, To: string) {
  const Res = await Payout(Token, OrganizerId, From, To);
  if (Res.Status !== 200) throw new Error(`payout failed ${Res.Status} ${Res.Text}`);
  const D = Res.Body.Data;
  return { Sales: Money(D.Sales), Refunds: Money(D.Refunds), Fee: Money(D.Fee), Net: Money(D.Net) };
}

export async function TicketStatus(Token: string, Id: number) {
  const Res = await GetTicket(Token, Id);
  return Res.Body?.Data?.Status as string | undefined;
}

export async function Setup(Categories: Category[] = [{ Name: "Regular", Price: "100.00", Capacity: 10 }], Sessions = ["2026-12-20T18:00:00Z"]) {
  const A = await NewCompany();
  const OrganizerId = await NewOrganizer(A.Token);
  const Event = await NewEvent(A.Token, OrganizerId, Sessions, Categories);
  const CustomerId = await NewCustomer(A.CompanyId);
  return { A, OrganizerId, Event, CustomerId, S1: Event.Sessions[0], C1: Event.Categories[0] };
}
