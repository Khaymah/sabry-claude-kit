import { Client } from "../../Database/Db";
import { AppError } from "../../Lib/Response";
import { Now } from "../../Lib/Clock";

export async function Q<T = any>(Text: string, Params: unknown[] = []) {
  return (await Client.query<T>(Text, Params)).rows;
}

export const IsoDay = (D: Date) => D.toISOString().slice(0, 10);

export function ShiftMonths(Day: string, Months: number) {
  const [Y, M, D] = Day.split("-").map(Number);
  const Total = Y * 12 + (M - 1) + Months;
  const Year = Math.floor(Total / 12);
  const Month = Total % 12;
  const Days = new Date(Date.UTC(Year, Month + 1, 0)).getUTCDate();
  return IsoDay(new Date(Date.UTC(Year, Month, Math.min(D, Days))));
}

export function Portions(Total: number, Count: number) {
  const Floor = Math.floor(Total / Count);
  const Out = new Array<number>(Count).fill(Floor);
  Out[Count - 1] = Total - Floor * (Count - 1);
  return Out;
}

type Sub = { Id: number; CompanyId: number; CustomerId: number; PlanId: number; Status: string; StartDate: string };

const SubColumns = `"Id", "CompanyId", "CustomerId", "PlanId", "Status", to_char("StartDate", 'YYYY-MM-DD') AS "StartDate"`;
const PlanColumns = `"Id", "Name", "PricePiasters" AS "Price", "IntervalMonths"`;

export async function CreatePlan(CompanyId: number, Name: string, Price: number, IntervalMonths: number) {
  const [Row] = await Q(`INSERT INTO "Plans" ("CompanyId","Name","PricePiasters","IntervalMonths") VALUES ($1,$2,$3,$4) RETURNING ${PlanColumns}`, [CompanyId, Name, Price, IntervalMonths]);
  return Row;
}

export async function ListPlans(CompanyId: number) {
  return Q(`SELECT ${PlanColumns} FROM "Plans" WHERE "CompanyId" = $1 ORDER BY "Id"`, [CompanyId]);
}

async function PlanOf(CompanyId: number, PlanId: number) {
  const [Row] = await Q<{ Id: number; Price: number; IntervalMonths: number }>(`SELECT ${PlanColumns} FROM "Plans" WHERE "Id" = $1 AND "CompanyId" = $2`, [PlanId, CompanyId]);
  if (!Row) throw new AppError(404, "NOT_FOUND", "Plan not found");
  return Row;
}

export async function GetSubscription(CompanyId: number, Id: number) {
  const [Row] = await Q<Sub>(`SELECT ${SubColumns} FROM "Subscriptions" WHERE "Id" = $1 AND "CompanyId" = $2`, [Id, CompanyId]);
  if (!Row) throw new AppError(404, "NOT_FOUND", "Subscription not found");
  return Row;
}

async function CatchUp(S: Sub) {
  const Plan = await PlanOf(S.CompanyId, S.PlanId);
  const Today = IsoDay(Now());
  const Rows: unknown[] = [];
  const Marks: string[] = [];
  for (let K = 0; ShiftMonths(S.StartDate, K) <= Today; K++) {
    const From = ShiftMonths(S.StartDate, K);
    const Base = Rows.length;
    Rows.push(S.CompanyId, S.Id, K, From, ShiftMonths(S.StartDate, K + 1), Portions(Plan.Price, Plan.IntervalMonths)[K % Plan.IntervalMonths]);
    Marks.push(`($${Base + 1}, $${Base + 2}, 'Cycle', $${Base + 3}, $${Base + 4}, $${Base + 5}, $${Base + 4}, $${Base + 6})`);
  }
  if (!Marks.length) return;
  await Q(
    `INSERT INTO "BillingInvoices" ("CompanyId","SubscriptionId","Source","PeriodNo","PeriodStart","PeriodEnd","DueDate","GrossPiasters") VALUES ${Marks.join(", ")} ON CONFLICT DO NOTHING`,
    Rows,
  );
}

export async function Subscribe(CompanyId: number, CustomerId: number, PlanId: number) {
  const [Customer] = await Q(`SELECT 1 FROM "Customers" WHERE "Id" = $1 AND "CompanyId" = $2`, [CustomerId, CompanyId]);
  if (!Customer) throw new AppError(404, "NOT_FOUND", "Customer not found");
  await PlanOf(CompanyId, PlanId);
  const [Row] = await Q<Sub>(
    `INSERT INTO "Subscriptions" ("CompanyId","CustomerId","PlanId","Status","StartDate") VALUES ($1,$2,$3,'Active',$4)
     ON CONFLICT ("CustomerId") WHERE "Status" = 'Active' DO NOTHING RETURNING ${SubColumns}`,
    [CompanyId, CustomerId, PlanId, IsoDay(Now())],
  );
  if (!Row) throw new AppError(409, "ALREADY_SUBSCRIBED", "The customer already has an active subscription");
  await CatchUp(Row);
  return Row;
}

export async function RunBilling(CompanyId: number) {
  const Subs = await Q<Sub>(`SELECT ${SubColumns} FROM "Subscriptions" WHERE "CompanyId" = $1 AND "Status" = 'Active'`, [CompanyId]);
  for (const S of Subs) await CatchUp(S);
  return { Processed: Subs.length };
}

export async function ChangePlan(CompanyId: number, Id: number, PlanId: number) {
  const S = await GetSubscription(CompanyId, Id);
  const Target = await PlanOf(CompanyId, PlanId);
  const Current = await PlanOf(CompanyId, S.PlanId);
  if (S.Status !== "Active" || Current.IntervalMonths !== 1 || Target.IntervalMonths !== 1 || Target.Price <= Current.Price)
    throw new AppError(409, "NOT_AN_UPGRADE", "Only upgrades between monthly plans are allowed");
  await CatchUp(S);
  const Today = IsoDay(Now());
  let K = 0;
  while (ShiftMonths(S.StartDate, K + 1) <= Today) K++;
  const From = Date.parse(ShiftMonths(S.StartDate, K));
  const To = Date.parse(ShiftMonths(S.StartDate, K + 1));
  const Left = Math.round((To - Date.parse(Today)) / 86400_000);
  const Length = Math.round((To - From) / 86400_000);
  const Charge = Math.floor(((Target.Price - Current.Price) * Left) / Length);
  return Client.transaction(async (Tx) => {
    const Moved = await Tx.query<Sub>(`UPDATE "Subscriptions" SET "PlanId" = $1 WHERE "Id" = $2 AND "PlanId" = $3 RETURNING ${SubColumns}`, [PlanId, Id, S.PlanId]);
    if (!Moved.rows[0]) throw new AppError(409, "CONFLICT", "The plan was changed meanwhile");
    const Made = await Tx.query<{ Id: number }>(
      `INSERT INTO "BillingInvoices" ("CompanyId","SubscriptionId","Source","PeriodStart","PeriodEnd","DueDate","GrossPiasters") VALUES ($1,$2,'Upgrade',$3,$4,$3,$5) RETURNING "Id"`,
      [CompanyId, Id, Today, ShiftMonths(S.StartDate, K + 1), Charge],
    );
    return { Subscription: Moved.rows[0], InvoiceId: Made.rows[0].Id };
  });
}
