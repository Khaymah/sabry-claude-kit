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

export async function NewCustomer(CompanyId: number, Fields: { Name?: string; Phone?: string | null; WalletBalance?: string } = {}) {
  const [Row] = await Sql<{ Id: number }>(
    `INSERT INTO "Customers" ("CompanyId","Name","Phone","WalletBalance") VALUES ($1,$2,$3,$4) RETURNING "Id"`,
    [CompanyId, Fields.Name ?? `Customer ${++Seq}`, Fields.Phone ?? null, Fields.WalletBalance ?? "0.00"],
  );
  return Row.Id;
}

export const Created = [200, 201];

export function At(Iso: string) {
  setSystemTime(new Date(Iso));
}

export async function NewPlan(Token: string, Price: number, IntervalMonths = 1, Name = `Plan ${++Seq}`) {
  const Res = await Call("POST", "/Plans", { Token, Body: { Name, Price, IntervalMonths } });
  if (!Created.includes(Res.Status)) throw new Error(`plan: ${Res.Status} ${Res.Text}`);
  return Res.Body.Data.Id as number;
}

export async function Subscribe(Token: string, CustomerId: number, PlanId: number) {
  return Call("POST", `/Customers/${CustomerId}/Subscriptions`, { Token, Body: { PlanId } });
}

export async function NewSubscription(Token: string, CompanyId: number, Price: number, IntervalMonths = 1) {
  const PlanId = await NewPlan(Token, Price, IntervalMonths);
  const CustomerId = await NewCustomer(CompanyId);
  const Res = await Subscribe(Token, CustomerId, PlanId);
  if (!Created.includes(Res.Status)) throw new Error(`subscribe: ${Res.Status} ${Res.Text}`);
  return { SubscriptionId: Res.Body.Data.Id as number, CustomerId, PlanId };
}

export async function Invoices(Token: string, SubscriptionId: number): Promise<any[]> {
  const Res = await Call("GET", `/Subscriptions/${SubscriptionId}/Invoices`, { Token });
  if (Res.Status !== 200) throw new Error(`invoices: ${Res.Status} ${Res.Text}`);
  const Data = Res.Body.Data;
  const List: any[] = Array.isArray(Data) ? Data : (Data.Items ?? Data.Invoices);
  return [...List].sort((A, B) => String(A.PeriodStart).localeCompare(String(B.PeriodStart)) || A.Id - B.Id);
}

export async function FirstInvoice(Token: string, SubscriptionId: number) {
  const List = await Invoices(Token, SubscriptionId);
  return List[0];
}

export async function RunBilling(Token: string) {
  return Call("POST", "/Billing/Run", { Token });
}

export async function GetInvoice(Token: string, Id: number) {
  return Call("GET", `/Invoices/${Id}`, { Token });
}

export async function Pay(Token: string, Id: number, Method = "Cash") {
  return Call("POST", `/Invoices/${Id}/Pay`, { Token, Body: { Method } });
}

export async function NewCoupon(Token: string, Code: string, PercentOff: number, MaxRedemptions = 100) {
  return Call("POST", "/Coupons", { Token, Body: { Code, PercentOff, MaxRedemptions } });
}

export async function ApplyCoupon(Token: string, Id: number, Code: string) {
  return Call("POST", `/Invoices/${Id}/ApplyCoupon`, { Token, Body: { Code } });
}

export async function Refund(Token: string, Id: number, Amount: unknown) {
  return Call("POST", `/Invoices/${Id}/Refunds`, { Token, Body: { Amount } });
}

export async function Split(Token: string, Id: number, Parts: unknown) {
  return Call("POST", `/Invoices/${Id}/Split`, { Token, Body: { Parts } });
}

export async function Revenue(Token: string, Date: string) {
  return Call("GET", `/Reports/DailyRevenue?Date=${Date}`, { Token });
}

export const Huge = 99999999999;
