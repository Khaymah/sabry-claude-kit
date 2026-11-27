import { and, asc, eq, sql } from "drizzle-orm";
import { Db, type Transaction } from "../../Database/Db";
import { Coupons, Customers, InvoicePayments, InvoiceRefunds, Invoices, Plans, Subscriptions } from "../../Database/Schema";
import { AppError } from "../../Lib/Response";
import { Now } from "../../Lib/Clock";

type Invoice = typeof Invoices.$inferSelect;
type Subscription = typeof Subscriptions.$inferSelect;

const DayMs = 86400_000;

function Today() {
  return Now().toISOString().slice(0, 10);
}

export function AddMonths(Start: string, Months: number) {
  const [Y, M, D] = Start.split("-").map(Number);
  const First = new Date(Date.UTC(Y, M - 1 + Months, 1));
  const Last = new Date(Date.UTC(First.getUTCFullYear(), First.getUTCMonth() + 1, 0)).getUTCDate();
  First.setUTCDate(Math.min(D, Last));
  return First.toISOString().slice(0, 10);
}

function DaysBetween(From: string, To: string) {
  return Math.round((Date.parse(`${To}T00:00:00Z`) - Date.parse(`${From}T00:00:00Z`)) / DayMs);
}

export function SplitAmount(Total: number, Parts: number) {
  const Each = Math.floor(Total / Parts);
  return Array.from({ length: Parts }, (_, I) => (I === Parts - 1 ? Total - Each * (Parts - 1) : Each));
}

function PeriodAmount(Price: number, IntervalMonths: number, PeriodNo: number) {
  return SplitAmount(Price, IntervalMonths)[PeriodNo % IntervalMonths];
}

export function PublicInvoice(Row: Invoice) {
  return {
    Id: Row.Id,
    SubscriptionId: Row.SubscriptionId,
    Kind: Row.Kind,
    PeriodStart: Row.PeriodStart,
    PeriodEnd: Row.PeriodEnd,
    DueDate: Row.DueDate,
    Amount: Row.Amount,
    Discount: Row.Discount,
    Status: Row.Status,
    AmountPaid: Row.AmountPaid,
    AmountRefunded: Row.AmountRefunded,
  };
}

export async function CreatePlan(CompanyId: number, Input: { Name: string; Price: number; IntervalMonths: number }) {
  const [Plan] = await Db.insert(Plans).values({ CompanyId, ...Input }).returning();
  return Plan;
}

export async function ListPlans(CompanyId: number) {
  return Db.select().from(Plans).where(eq(Plans.CompanyId, CompanyId)).orderBy(asc(Plans.Id));
}

async function FindPlan(Tx: Transaction, CompanyId: number, PlanId: number) {
  const [Plan] = await Tx.select().from(Plans).where(and(eq(Plans.Id, PlanId), eq(Plans.CompanyId, CompanyId)));
  if (!Plan) throw new AppError(404, "NOT_FOUND", "Plan not found");
  return Plan;
}

async function IssueDueInvoices(Tx: Transaction, Sub: Subscription) {
  if (Sub.Status !== "Active") return;
  const [Plan] = await Tx.select().from(Plans).where(eq(Plans.Id, Sub.PlanId));
  const Rows = await Tx.select({ PeriodNo: Invoices.PeriodNo })
    .from(Invoices)
    .where(and(eq(Invoices.SubscriptionId, Sub.Id), eq(Invoices.Kind, "Period")));
  const Have = new Set(Rows.map((R) => R.PeriodNo));
  const Limit = Today();
  const Values = [];
  for (let K = 0; AddMonths(Sub.StartDate, K) <= Limit; K++) {
    if (Have.has(K)) continue;
    const PeriodStart = AddMonths(Sub.StartDate, K);
    Values.push({
      CompanyId: Sub.CompanyId,
      SubscriptionId: Sub.Id,
      Kind: "Period",
      PeriodNo: K,
      PeriodStart,
      PeriodEnd: AddMonths(Sub.StartDate, K + 1),
      DueDate: PeriodStart,
      Amount: PeriodAmount(Plan.Price, Plan.IntervalMonths, K),
    });
  }
  if (Values.length) await Tx.insert(Invoices).values(Values).onConflictDoNothing();
}

export async function Subscribe(CompanyId: number, CustomerId: number, PlanId: number) {
  return Db.transaction(async (Tx) => {
    const [Customer] = await Tx.select({ Id: Customers.Id })
      .from(Customers)
      .where(and(eq(Customers.Id, CustomerId), eq(Customers.CompanyId, CompanyId)))
      .for("update");
    if (!Customer) throw new AppError(404, "NOT_FOUND", "Customer not found");
    await FindPlan(Tx, CompanyId, PlanId);
    const [Active] = await Tx.select({ Id: Subscriptions.Id })
      .from(Subscriptions)
      .where(and(eq(Subscriptions.CustomerId, CustomerId), eq(Subscriptions.Status, "Active")));
    if (Active) throw new AppError(409, "ALREADY_SUBSCRIBED", "The customer already has an active subscription");
    const [Sub] = await Tx.insert(Subscriptions).values({ CompanyId, CustomerId, PlanId, StartDate: Today() }).returning();
    await IssueDueInvoices(Tx, Sub);
    return Sub;
  });
}

export async function GetSubscription(CompanyId: number, Id: number) {
  const [Sub] = await Db.select()
    .from(Subscriptions)
    .where(and(eq(Subscriptions.Id, Id), eq(Subscriptions.CompanyId, CompanyId)));
  if (!Sub) throw new AppError(404, "NOT_FOUND", "Subscription not found");
  return Sub;
}

export async function ListInvoices(CompanyId: number, SubscriptionId: number) {
  await GetSubscription(CompanyId, SubscriptionId);
  const Rows = await Db.select()
    .from(Invoices)
    .where(and(eq(Invoices.SubscriptionId, SubscriptionId), eq(Invoices.CompanyId, CompanyId)))
    .orderBy(asc(Invoices.DueDate), asc(Invoices.Id));
  return Rows.map(PublicInvoice);
}

export async function RunBilling(CompanyId: number) {
  return Db.transaction(async (Tx) => {
    const Subs = await Tx.select()
      .from(Subscriptions)
      .where(and(eq(Subscriptions.CompanyId, CompanyId), eq(Subscriptions.Status, "Active")))
      .for("update");
    for (const Sub of Subs) await IssueDueInvoices(Tx, Sub);
    return { Subscriptions: Subs.length };
  });
}

async function LockInvoice(Tx: Transaction, CompanyId: number, Id: number) {
  const [Row] = await Tx.select()
    .from(Invoices)
    .where(and(eq(Invoices.Id, Id), eq(Invoices.CompanyId, CompanyId)))
    .for("update");
  if (!Row) throw new AppError(404, "NOT_FOUND", "Invoice not found");
  return Row;
}

export async function GetInvoice(CompanyId: number, Id: number) {
  const [Row] = await Db.select()
    .from(Invoices)
    .where(and(eq(Invoices.Id, Id), eq(Invoices.CompanyId, CompanyId)));
  if (!Row) throw new AppError(404, "NOT_FOUND", "Invoice not found");
  return PublicInvoice(Row);
}

export async function PayInvoice(CompanyId: number, Id: number, Method: string) {
  return Db.transaction(async (Tx) => {
    const Row = await LockInvoice(Tx, CompanyId, Id);
    if (Row.Status !== "Open") throw new AppError(409, "NOT_PAYABLE", "This invoice is not open");
    const [Payment] = await Tx.insert(InvoicePayments)
      .values({ CompanyId, InvoiceId: Id, Amount: Row.Amount, Method, PaidAt: Now() })
      .returning();
    const [Updated] = await Tx.update(Invoices)
      .set({ Status: "Paid", AmountPaid: Row.Amount })
      .where(eq(Invoices.Id, Id))
      .returning();
    return { Payment, Invoice: PublicInvoice(Updated) };
  });
}

export async function CreateCoupon(CompanyId: number, Input: { Code: string; PercentOff: number; MaxRedemptions: number }) {
  const [Coupon] = await Db.insert(Coupons).values({ CompanyId, ...Input }).onConflictDoNothing().returning();
  if (!Coupon) throw new AppError(409, "DUPLICATE_CODE", "This code already exists");
  return Coupon;
}

export async function ApplyCoupon(CompanyId: number, Id: number, Code: string) {
  return Db.transaction(async (Tx) => {
    const Row = await LockInvoice(Tx, CompanyId, Id);
    const [Coupon] = await Tx.select()
      .from(Coupons)
      .where(and(eq(Coupons.CompanyId, CompanyId), eq(Coupons.Code, Code)))
      .for("update");
    if (!Coupon) throw new AppError(404, "NOT_FOUND", "Coupon not found");
    if (Row.Status !== "Open") throw new AppError(409, "NOT_OPEN", "Coupons apply to open invoices only");
    if (Row.CouponId !== null) throw new AppError(409, "COUPON_EXISTS", "This invoice already has a coupon");
    if (Coupon.Redemptions >= Coupon.MaxRedemptions) throw new AppError(409, "COUPON_EXHAUSTED", "This coupon is used up");
    const Payable = Math.floor((Row.Amount * (100 - Coupon.PercentOff)) / 100);
    await Tx.update(Coupons).set({ Redemptions: Coupon.Redemptions + 1 }).where(eq(Coupons.Id, Coupon.Id));
    const [Updated] = await Tx.update(Invoices)
      .set({ Amount: Payable, Discount: Row.Discount + Row.Amount - Payable, CouponId: Coupon.Id })
      .where(eq(Invoices.Id, Id))
      .returning();
    return PublicInvoice(Updated);
  });
}

export async function ChangePlan(CompanyId: number, Id: number, PlanId: number) {
  return Db.transaction(async (Tx) => {
    const [Sub] = await Tx.select()
      .from(Subscriptions)
      .where(and(eq(Subscriptions.Id, Id), eq(Subscriptions.CompanyId, CompanyId)))
      .for("update");
    if (!Sub) throw new AppError(404, "NOT_FOUND", "Subscription not found");
    const Next = await FindPlan(Tx, CompanyId, PlanId);
    const [Current] = await Tx.select().from(Plans).where(eq(Plans.Id, Sub.PlanId));
    if (Sub.Status !== "Active") throw new AppError(409, "NOT_ACTIVE", "The subscription is not active");
    if (Current.IntervalMonths !== 1 || Next.IntervalMonths !== 1 || Next.Price <= Current.Price)
      throw new AppError(409, "NOT_AN_UPGRADE", "Only upgrades between monthly plans are allowed");
    await IssueDueInvoices(Tx, Sub);
    const Day = Today();
    let K = 0;
    while (AddMonths(Sub.StartDate, K + 1) <= Day) K++;
    const PeriodStart = AddMonths(Sub.StartDate, K);
    const PeriodEnd = AddMonths(Sub.StartDate, K + 1);
    const Amount = Math.floor(((Next.Price - Current.Price) * DaysBetween(Day, PeriodEnd)) / DaysBetween(PeriodStart, PeriodEnd));
    const [Updated] = await Tx.update(Subscriptions).set({ PlanId }).where(eq(Subscriptions.Id, Id)).returning();
    const [Invoice] = await Tx.insert(Invoices)
      .values({ CompanyId, SubscriptionId: Id, Kind: "Proration", PeriodStart: Day, PeriodEnd, DueDate: Day, Amount })
      .returning();
    return { Subscription: Updated, Invoice: PublicInvoice(Invoice) };
  });
}

export async function RefundInvoice(CompanyId: number, Id: number, Amount: number, Reason?: string) {
  return Db.transaction(async (Tx) => {
    const Row = await LockInvoice(Tx, CompanyId, Id);
    if (Row.Status !== "Paid") throw new AppError(409, "NOT_PAID", "Only paid invoices can be refunded");
    if (Row.AmountRefunded + Amount > Row.AmountPaid) throw new AppError(409, "OVER_REFUND", "Refund exceeds what was paid");
    const [Refund] = await Tx.insert(InvoiceRefunds)
      .values({ CompanyId, InvoiceId: Id, Amount, Reason, RefundedAt: Now() })
      .returning();
    const [Updated] = await Tx.update(Invoices)
      .set({ AmountRefunded: Row.AmountRefunded + Amount })
      .where(eq(Invoices.Id, Id))
      .returning();
    return { Refund, Invoice: PublicInvoice(Updated) };
  });
}

export async function SplitInvoice(CompanyId: number, Id: number, Parts: number) {
  return Db.transaction(async (Tx) => {
    const Row = await LockInvoice(Tx, CompanyId, Id);
    if (Row.Status !== "Open") throw new AppError(409, "NOT_OPEN", "Only open invoices can be split");
    if (Row.Amount < Parts) throw new AppError(409, "TOO_SMALL", "The invoice is too small to split");
    const Day = Today();
    await Tx.update(Invoices).set({ Status: "Void" }).where(eq(Invoices.Id, Id));
    const Created = await Tx.insert(Invoices)
      .values(
        SplitAmount(Row.Amount, Parts).map((Amount, I) => ({
          CompanyId,
          SubscriptionId: Row.SubscriptionId,
          Kind: "Part",
          PeriodStart: Row.PeriodStart,
          PeriodEnd: Row.PeriodEnd,
          DueDate: AddMonths(Day, I),
          Amount,
          CouponId: Row.CouponId,
          SplitFromId: Row.Id,
        })),
      )
      .returning();
    return { Invoices: Created.sort((A, B) => A.Id - B.Id).map(PublicInvoice) };
  });
}

export async function DailyRevenue(CompanyId: number, Day: string) {
  const [Paid] = await Db.select({ S: sql<string>`coalesce(sum(${InvoicePayments.Amount}), 0)::text` })
    .from(InvoicePayments)
    .where(and(eq(InvoicePayments.CompanyId, CompanyId), sql`(${InvoicePayments.PaidAt} AT TIME ZONE 'Africa/Cairo')::date = ${Day}::date`));
  const [Back] = await Db.select({ S: sql<string>`coalesce(sum(${InvoiceRefunds.Amount}), 0)::text` })
    .from(InvoiceRefunds)
    .where(and(eq(InvoiceRefunds.CompanyId, CompanyId), sql`(${InvoiceRefunds.RefundedAt} AT TIME ZONE 'Africa/Cairo')::date = ${Day}::date`));
  const Collected = Number(Paid.S);
  const Refunded = Number(Back.S);
  return { Date: Day, Collected, Refunded, Net: Collected - Refunded };
}
