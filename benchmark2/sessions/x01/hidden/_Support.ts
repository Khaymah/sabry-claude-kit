import { setSystemTime } from "bun:test";
import { App } from "../../Src/App";
import { Client } from "../../Src/Database/Db";
import { Migrate } from "../../Src/Database/Migrations";

export async function Reset(UpTo?: string) {
  setSystemTime();
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

export const At = (Iso: string) => setSystemTime(new Date(Iso));
export const RealTime = () => setSystemTime();

let Seq = 0;
const Hash = await Bun.password.hash("Password123!", { algorithm: "bcrypt", cost: 4 });

async function NewSession(UserId: number) {
  const Token = `tok_${++Seq}_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  await Sql(`INSERT INTO "Sessions" ("Token","UserId","ExpiresAt") VALUES ($1,$2, now() + interval '3650 days')`, [Token, UserId]);
  return Token;
}

export async function NewUser(CompanyId: number, Role = "Staff", Name = `User ${++Seq}`) {
  const Email = `u${++Seq}_${Math.random().toString(36).slice(2, 8)}@example.com`;
  const [User] = await Sql<{ Id: number }>(
    `INSERT INTO "Users" ("CompanyId","Email","Name","PasswordHash","Role") VALUES ($1,$2,$3,$4,$5) RETURNING "Id"`,
    [CompanyId, Email, Name, Hash, Role],
  );
  return { UserId: User.Id, Token: await NewSession(User.Id) };
}

export async function NewCompany(Name = `Company ${++Seq}`) {
  const [Company] = await Sql<{ Id: number }>(`INSERT INTO "Companies" ("Name") VALUES ($1) RETURNING "Id"`, [Name]);
  const Owner = await NewUser(Company.Id, "Owner", `Owner ${Seq}`);
  return { CompanyId: Company.Id, ...Owner };
}

export async function NewEmployee(OwnerToken: string, Name = `Employee ${++Seq}`, Role = "Staff") {
  const Email = `e${++Seq}_${Math.random().toString(36).slice(2, 8)}@example.com`;
  const Res = await Call("POST", "/Users", { Token: OwnerToken, Body: { Email, Name, Password: "Password123!", Role } });
  if (!Created(Res.Status)) throw new Error(`user create failed ${Res.Status} ${Res.Text}`);
  const UserId = Number(Res.Body.Data.Id);
  return { UserId, Token: await NewSession(UserId), Name };
}

export const Created = (Status: number) => Status === 200 || Status === 201;

export function ListOf(Data: any): any[] {
  if (Array.isArray(Data)) return Data;
  if (Data && Array.isArray(Data.Items)) return Data.Items;
  return [];
}

export const Pt = (Value: unknown) => Math.round(Number(Value) * 100);
export const Day = (Value: unknown) => String(Value).slice(0, 10);

export function PutEmployee(Token: string, UserId: number | string, Body: unknown) {
  return Call("PUT", `/Employees/${UserId}`, { Token, Body });
}

export async function SetEmployee(Token: string, UserId: number, MonthlySalary: string, ShiftStart = "09:00", ShiftEnd = "17:00") {
  const Res = await PutEmployee(Token, UserId, { MonthlySalary, ShiftStart, ShiftEnd });
  if (!Created(Res.Status)) throw new Error(`employee update failed ${Res.Status} ${Res.Text}`);
}

export async function Employees(Token: string) {
  return ListOf((await Call("GET", "/Employees", { Token })).Body?.Data);
}

export function CheckIn(Token: string, Iso?: string) {
  if (Iso) At(Iso);
  return Call("POST", "/Attendance/CheckIn", { Token });
}

export function CheckOut(Token: string, Iso?: string) {
  if (Iso) At(Iso);
  return Call("POST", "/Attendance/CheckOut", { Token });
}

export async function Work(Token: string, InIso: string, OutIso: string) {
  const In = await CheckIn(Token, InIso);
  if (!Created(In.Status)) throw new Error(`check-in failed ${In.Status} ${In.Text}`);
  const Out = await CheckOut(Token, OutIso);
  if (!Created(Out.Status)) throw new Error(`check-out failed ${Out.Status} ${Out.Text}`);
  return { In, Out };
}

export async function AttendanceOf(Token: string, UserId: number | string, Month: string) {
  const Res = await Call("GET", `/Attendance?UserId=${UserId}&Month=${Month}`, { Token });
  return { Status: Res.Status, Items: ListOf(Res.Body?.Data) };
}

export function Leave(Token: string, UserId: number | string, Type: string, From: string, To: string) {
  return Call("POST", `/Employees/${UserId}/Leaves`, { Token, Body: { Type, From, To } });
}

export async function LeaveOk(Token: string, UserId: number, Type: string, From: string, To: string) {
  const Res = await Leave(Token, UserId, Type, From, To);
  if (!Created(Res.Status)) throw new Error(`leave failed ${Res.Status} ${Res.Text}`);
  return Number(Res.Body.Data.Id);
}

export async function Balance(Token: string, UserId: number | string) {
  const Res = await Call("GET", `/Employees/${UserId}/LeaveBalance`, { Token });
  return { Status: Res.Status, Entitled: Number(Res.Body?.Data?.Entitled), Used: Number(Res.Body?.Data?.Used), Remaining: Number(Res.Body?.Data?.Remaining) };
}

export const CancelLeave = (Token: string, Id: number | string) => Call("POST", `/Leaves/${Id}/Cancel`, { Token });

export const Run = (Token: string, Month: string) => Call("POST", "/Payroll/Runs", { Token, Body: { Month } });

export async function RunOk(Token: string, Month: string) {
  const Res = await Run(Token, Month);
  if (!Created(Res.Status)) throw new Error(`payroll run failed ${Res.Status} ${Res.Text}`);
  return { Id: Number(Res.Body.Data.Id), Payslips: ListOf(Res.Body.Data.Payslips), Res };
}

export const SlipOf = (Payslips: any[], UserId: number) => Payslips.find((P: any) => Number(P.UserId) === UserId);

export const VoidRun = (Token: string, Id: number | string) => Call("POST", `/Payroll/Runs/${Id}/Void`, { Token });

export function PayslipPage(Token: string, Month: string, Page = 1, PageSize = 100) {
  return Call("GET", `/Payroll/Payslips?Month=${Month}&Page=${Page}&PageSize=${PageSize}`, { Token });
}

export async function AllPayslips(Token: string, Month: string) {
  const All: any[] = [];
  for (let Page = 1; Page <= 20; Page++) {
    const Res = await PayslipPage(Token, Month, Page, 100);
    if (Res.Status !== 200) return { Status: Res.Status, Items: All, Res };
    const Items = ListOf(Res.Body?.Data);
    All.push(...Items);
    if (Items.length < 100) return { Status: 200, Items: All, Res };
  }
  return { Status: 200, Items: All };
}

export const MySlip = (Token: string, Month: string) => Call("GET", `/Payroll/Payslips/Me?Month=${Month}`, { Token });
