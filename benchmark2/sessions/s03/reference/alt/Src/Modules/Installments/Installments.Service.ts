import { and, count, desc, eq, sql } from "drizzle-orm";
import { Db, type Transaction } from "../../Database/Db";
import { InstallmentPlans, Orders, Payments, type ScheduleEntry } from "../../Database/Schema";
import { AppError } from "../../Lib/Response";
import { Now } from "../../Lib/Clock";
import { FromPiasters, ToPiasters } from "../../Lib/Money";
import { PageMeta } from "../../Lib/Pagination";
import { GetCustomer } from "../Customers/Customers.Service";

function MonthsLater(Start: Date, N: number) {
  const Y = Start.getUTCFullYear();
  const M = Start.getUTCMonth() + N;
  const Days = new Date(Date.UTC(Y, M + 1, 0)).getUTCDate();
  return new Date(Date.UTC(Y, M, Math.min(Start.getUTCDate(), Days))).toISOString().slice(0, 10);
}

function Schedule(Total: number, Count: number, FirstNo: number): ScheduleEntry[] {
  const Out: ScheduleEntry[] = [];
  let Given = 0;
  for (let I = 0; I < Count; I++) {
    const Upto = Math.round((Total * (I + 1)) / Count);
    Out.push({ No: FirstNo + I, DueDate: MonthsLater(Now(), I), Amount: FromPiasters(Upto - Given), Status: "Due", PaymentId: null });
    Given = Upto;
  }
  return Out;
}

async function Context(Tx: Transaction, CompanyId: number, OrderId: number) {
  const [Order] = await Tx.select().from(Orders).where(and(eq(Orders.Id, OrderId), eq(Orders.CompanyId, CompanyId))).for("update");
  if (!Order) throw new AppError(404, "NOT_FOUND", "Order not found");
  const [Plan] = await Tx.select().from(InstallmentPlans).where(eq(InstallmentPlans.OrderId, OrderId));
  const [{ Paid }] = await Tx.select({ Paid: sql<string>`coalesce(sum(${Payments.Amount}), 0)::text` }).from(Payments).where(and(eq(Payments.OrderId, OrderId), eq(Payments.Status, "Completed")));
  return { Order, Plan, Left: ToPiasters(Order.Total) - ToPiasters(Paid) };
}

export async function GetPlan(CompanyId: number, OrderId: number) {
  const [Order] = await Db.select({ Id: Orders.Id }).from(Orders).where(and(eq(Orders.Id, OrderId), eq(Orders.CompanyId, CompanyId)));
  if (!Order) throw new AppError(404, "NOT_FOUND", "Order not found");
  const [Plan] = await Db.select().from(InstallmentPlans).where(eq(InstallmentPlans.OrderId, OrderId));
  return { OrderId, Installments: Plan?.Schedule ?? [] };
}

export async function CreatePlan(CompanyId: number, OrderId: number, Count: number) {
  return Db.transaction(async (Tx) => {
    const { Order, Plan, Left } = await Context(Tx, CompanyId, OrderId);
    if (Order.Status !== "Pending" || Plan) throw new AppError(409, "PLAN_NOT_ALLOWED", "This order cannot get a new plan");
    if (Left < Count) throw new AppError(409, "NOTHING_TO_SPLIT", "Nothing left to split");
    const Entries = Schedule(Left, Count, 1);
    await Tx.insert(InstallmentPlans).values({ OrderId, CompanyId, Schedule: Entries });
    return { OrderId, Installments: Entries };
  });
}

export async function Replan(CompanyId: number, OrderId: number, Count: number) {
  return Db.transaction(async (Tx) => {
    const { Order, Plan, Left } = await Context(Tx, CompanyId, OrderId);
    if (!Plan) throw new AppError(404, "NOT_FOUND", "No plan");
    if (Order.Status !== "Pending" || Left <= 0) throw new AppError(409, "INVALID_STATUS", "The plan is already paid");
    const Kept = Plan.Schedule.filter((E) => E.Status === "Paid");
    const Entries = [...Kept, ...Schedule(Left, Count, Math.max(0, ...Kept.map((E) => E.No)) + 1)];
    await Tx.update(InstallmentPlans).set({ Schedule: Entries, UpdatedAt: Now() }).where(eq(InstallmentPlans.OrderId, OrderId));
    return { OrderId, Installments: Entries };
  });
}

export async function PayInstallment(CompanyId: number, OrderId: number, No: number, Method: string) {
  return Db.transaction(async (Tx) => {
    const { Order, Plan, Left } = await Context(Tx, CompanyId, OrderId);
    const Entry = Plan?.Schedule.find((E) => E.No === No);
    if (!Plan || !Entry) throw new AppError(404, "NOT_FOUND", "Installment not found");
    if (Entry.Status === "Paid" || Order.Status !== "Pending") throw new AppError(409, "ALREADY_PAID", "Already paid");
    const [Payment] = await Tx.insert(Payments).values({ CompanyId, OrderId, Amount: Entry.Amount, Method }).returning();
    const Updated = Plan.Schedule.map((E) => (E.No === No ? { ...E, Status: "Paid" as const, PaymentId: Payment.Id } : E));
    await Tx.update(InstallmentPlans).set({ Schedule: Updated, UpdatedAt: Now() }).where(eq(InstallmentPlans.OrderId, OrderId));
    if (Left - ToPiasters(Entry.Amount) <= 0) await Tx.update(Orders).set({ Status: "Paid" }).where(eq(Orders.Id, OrderId));
    return { Payment, Installment: { ...Entry, Status: "Paid", PaymentId: Payment.Id } };
  });
}

export async function CustomerOrders(CompanyId: number, CustomerId: number, Page: number, PageSize: number) {
  await GetCustomer(CompanyId, CustomerId);
  const Where = and(eq(Orders.CompanyId, CompanyId), eq(Orders.CustomerId, CustomerId));
  const Items = await Db.select().from(Orders).where(Where).orderBy(desc(Orders.CreatedAt), desc(Orders.Id)).limit(PageSize).offset((Page - 1) * PageSize);
  const [{ Total }] = await Db.select({ Total: count() }).from(Orders).where(Where);
  return { Items, ...PageMeta(Page, PageSize, Total) };
}

export async function OverdueInstallments(CompanyId: number, Page: number, PageSize: number) {
  const Today = Now().toISOString().slice(0, 10);
  const Rows = await Db.execute<{ OrderId: number; No: number; DueDate: string; Amount: string; CustomerName: string; CustomerPhone: string | null; Total: number }>(sql`
    SELECT p."OrderId", (e->>'No')::int AS "No", e->>'DueDate' AS "DueDate", e->>'Amount' AS "Amount",
           c."Name" AS "CustomerName", c."Phone" AS "CustomerPhone", count(*) OVER ()::int AS "Total"
    FROM "InstallmentPlans" p
    CROSS JOIN LATERAL jsonb_array_elements(p."Schedule") e
    JOIN "Orders" o ON o."Id" = p."OrderId"
    JOIN "Customers" c ON c."Id" = o."CustomerId"
    WHERE p."CompanyId" = ${CompanyId} AND e->>'Status' = 'Due' AND (e->>'DueDate')::date < ${Today}::date
    ORDER BY (e->>'DueDate')::date, p."OrderId", (e->>'No')::int
    LIMIT ${PageSize} OFFSET ${(Page - 1) * PageSize}
  `);
  const Total = Rows.rows[0]?.Total ?? 0;
  return { Items: Rows.rows.map(({ Total: _, ...R }) => R), ...PageMeta(Page, PageSize, Total) };
}
