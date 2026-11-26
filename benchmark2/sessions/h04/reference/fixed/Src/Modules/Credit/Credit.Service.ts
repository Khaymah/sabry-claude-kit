import { and, asc, desc, eq, sql } from "drizzle-orm";
import { Db, type Transaction } from "../../Database/Db";
import { CreditAccounts, CreditEntries, CreditLimitChanges, CreditPayments, Customers, Orders, Payments } from "../../Database/Schema";
import { AppError } from "../../Lib/Response";
import { Now } from "../../Lib/Clock";
import { FromPiasters, ToPiasters } from "../../Lib/Money";
import { PageMeta } from "../../Lib/Pagination";

type Executor = Transaction | typeof Db;
type Allocation = { OrderId: number; Amount: string };

const DueDays = 30;
const DayMs = 86400_000;

async function FindCustomer(Ex: Executor, CompanyId: number, CustomerId: number, Lock = false) {
  const Query = Ex.select({ Id: Customers.Id, Name: Customers.Name, Phone: Customers.Phone })
    .from(Customers)
    .where(and(eq(Customers.Id, CustomerId), eq(Customers.CompanyId, CompanyId)));
  const [Customer] = Lock ? await Query.for("update") : await Query;
  if (!Customer) throw new AppError(404, "NOT_FOUND", "Customer not found");
  return Customer;
}

async function LockOrder(Tx: Transaction, CompanyId: number, OrderId: number) {
  const [Order] = await Tx.select().from(Orders).where(and(eq(Orders.Id, OrderId), eq(Orders.CompanyId, CompanyId))).for("update");
  if (!Order) throw new AppError(404, "NOT_FOUND", "Order not found");
  return Order;
}

async function LimitOf(Ex: Executor, CustomerId: number) {
  const [Row] = await Ex.select({ Limit: CreditAccounts.Limit }).from(CreditAccounts).where(eq(CreditAccounts.CustomerId, CustomerId));
  return Row ? ToPiasters(Row.Limit) : 0;
}

async function BalanceOf(Ex: Executor, CustomerId: number) {
  const [{ Sum }] = await Ex.select({ Sum: sql<string>`coalesce(sum(${CreditEntries.Amount}), 0)::text` })
    .from(CreditEntries)
    .where(eq(CreditEntries.CustomerId, CustomerId));
  return ToPiasters(Sum);
}

export async function OrderRemaining(Ex: Executor, OrderId: number) {
  const [{ Sum }] = await Ex.select({ Sum: sql<string>`coalesce(sum(${CreditEntries.Amount}), 0)::text` })
    .from(CreditEntries)
    .where(eq(CreditEntries.OrderId, OrderId));
  return ToPiasters(Sum);
}

async function AccountView(Ex: Executor, CustomerId: number) {
  const Limit = await LimitOf(Ex, CustomerId);
  const Balance = await BalanceOf(Ex, CustomerId);
  return { CustomerId, Limit: FromPiasters(Limit), Balance: FromPiasters(Balance), Available: FromPiasters(Math.max(0, Limit - Balance)) };
}

export async function GetCredit(CompanyId: number, CustomerId: number) {
  await FindCustomer(Db, CompanyId, CustomerId);
  return AccountView(Db, CustomerId);
}

export async function SetCreditLimit(CompanyId: number, UserId: number, Role: string, CustomerId: number, Limit: string) {
  if (Role !== "Owner") throw new AppError(403, "FORBIDDEN", "Only the owner can change credit limits");
  return Db.transaction(async (Tx) => {
    await FindCustomer(Tx, CompanyId, CustomerId, true);
    const Old = await LimitOf(Tx, CustomerId);
    const New = ToPiasters(Limit);
    await Tx.insert(CreditAccounts)
      .values({ CustomerId, CompanyId, Limit: FromPiasters(New) })
      .onConflictDoUpdate({ target: CreditAccounts.CustomerId, set: { Limit: FromPiasters(New) } });
    await Tx.insert(CreditLimitChanges).values({
      CompanyId,
      CustomerId,
      OldLimit: FromPiasters(Old),
      NewLimit: FromPiasters(New),
      ChangedByUserId: UserId,
      ChangedAt: Now(),
    });
    return AccountView(Tx, CustomerId);
  });
}

export async function ListLimitChanges(CompanyId: number, CustomerId: number) {
  await FindCustomer(Db, CompanyId, CustomerId);
  return Db.select({
    OldLimit: CreditLimitChanges.OldLimit,
    NewLimit: CreditLimitChanges.NewLimit,
    ChangedByUserId: CreditLimitChanges.ChangedByUserId,
    ChangedAt: CreditLimitChanges.ChangedAt,
  })
    .from(CreditLimitChanges)
    .where(and(eq(CreditLimitChanges.CompanyId, CompanyId), eq(CreditLimitChanges.CustomerId, CustomerId)))
    .orderBy(desc(CreditLimitChanges.ChangedAt), desc(CreditLimitChanges.Id));
}

export async function ChargeToCredit(CompanyId: number, OrderId: number) {
  return Db.transaction(async (Tx) => {
    const Order = await LockOrder(Tx, CompanyId, OrderId);
    if (Order.Status !== "Pending") throw new AppError(409, "INVALID_STATUS", "Only pending orders can be charged to credit");
    await FindCustomer(Tx, CompanyId, Order.CustomerId, true);
    const [{ Paid }] = await Tx.select({ Paid: sql<string>`coalesce(sum(${Payments.Amount}), 0)::text` })
      .from(Payments)
      .where(and(eq(Payments.OrderId, Order.Id), eq(Payments.Status, "Completed")));
    const Unpaid = ToPiasters(Order.Total) - ToPiasters(Paid);
    if (Unpaid <= 0) throw new AppError(409, "NOTHING_TO_CHARGE", "Nothing left to charge");
    const Limit = await LimitOf(Tx, Order.CustomerId);
    const Balance = await BalanceOf(Tx, Order.CustomerId);
    if (Balance + Unpaid > Limit) throw new AppError(409, "CREDIT_LIMIT_EXCEEDED", "This purchase exceeds the customer's credit limit");
    await Tx.insert(CreditEntries).values({ CompanyId, CustomerId: Order.CustomerId, OrderId, Type: "Purchase", Amount: FromPiasters(Unpaid), CreatedAt: Now() });
    await Tx.update(Orders).set({ Status: "OnCredit" }).where(eq(Orders.Id, OrderId));
    return { OrderId, Amount: FromPiasters(Unpaid), ...(await AccountView(Tx, Order.CustomerId)) };
  });
}

async function OpenDebts(Ex: Executor, CustomerId: number) {
  const Rows = await Ex.select({
    OrderId: CreditEntries.OrderId,
    ChargedAt: sql<string>`min(${CreditEntries.CreatedAt}) FILTER (WHERE ${CreditEntries.Type} = 'Purchase')`,
    Remaining: sql<string>`sum(${CreditEntries.Amount})::text`,
  })
    .from(CreditEntries)
    .where(eq(CreditEntries.CustomerId, CustomerId))
    .groupBy(CreditEntries.OrderId)
    .having(sql`sum(${CreditEntries.Amount}) > 0`)
    .orderBy(sql`2 ASC`, asc(CreditEntries.OrderId));
  return Rows.map((R) => ({ OrderId: R.OrderId, Remaining: ToPiasters(R.Remaining) }));
}

export async function PayCredit(CompanyId: number, CustomerId: number, Input: { Amount: string; Method: string; RequestId: string }) {
  const Amount = ToPiasters(Input.Amount);
  if (Amount <= 0) throw new AppError(400, "VALIDATION_ERROR", "Amount must be positive");
  return Db.transaction(async (Tx) => {
    await FindCustomer(Tx, CompanyId, CustomerId, true);
    const [Previous] = await Tx.select()
      .from(CreditPayments)
      .where(and(eq(CreditPayments.CompanyId, CompanyId), eq(CreditPayments.RequestId, Input.RequestId)));
    if (Previous) {
      return { Id: Previous.Id, Amount: Previous.Amount, Allocations: Previous.Allocations as Allocation[], Balance: FromPiasters(await BalanceOf(Tx, Previous.CustomerId)) };
    }
    const Balance = await BalanceOf(Tx, CustomerId);
    if (Amount > Balance) throw new AppError(409, "OVERPAYMENT", "Amount exceeds the customer's debt");
    const At = Now();
    const Allocations: { OrderId: number; Amount: number; Closes: boolean }[] = [];
    let Left = Amount;
    for (const Debt of await OpenDebts(Tx, CustomerId)) {
      if (Left === 0) break;
      const Part = Math.min(Left, Debt.Remaining);
      Allocations.push({ OrderId: Debt.OrderId, Amount: Part, Closes: Part === Debt.Remaining });
      Left -= Part;
    }
    const Saved = Allocations.map((A) => ({ OrderId: A.OrderId, Amount: FromPiasters(A.Amount) }));
    const [Payment] = await Tx.insert(CreditPayments)
      .values({ CompanyId, CustomerId, RequestId: Input.RequestId, Amount: FromPiasters(Amount), Method: Input.Method, Allocations: Saved, CreatedAt: At })
      .returning();
    for (const A of Allocations) {
      await Tx.insert(CreditEntries).values({ CompanyId, CustomerId, OrderId: A.OrderId, Type: "Payment", Amount: FromPiasters(-A.Amount), CreditPaymentId: Payment.Id, CreatedAt: At });
      await Tx.insert(Payments).values({ CompanyId, OrderId: A.OrderId, Amount: FromPiasters(A.Amount), Method: Input.Method, CreatedAt: At });
      if (A.Closes) await Tx.update(Orders).set({ Status: "Paid" }).where(eq(Orders.Id, A.OrderId));
    }
    return { Id: Payment.Id, Amount: Payment.Amount, Allocations: Saved, Balance: FromPiasters(Balance - Amount) };
  });
}

export async function Statement(CompanyId: number, CustomerId: number) {
  await FindCustomer(Db, CompanyId, CustomerId);
  const Rows = await Db.select()
    .from(CreditEntries)
    .where(and(eq(CreditEntries.CompanyId, CompanyId), eq(CreditEntries.CustomerId, CustomerId)))
    .orderBy(asc(CreditEntries.CreatedAt), asc(CreditEntries.Id));
  const Entries: { Type: string; OrderId: number | null; Amount: string; Balance: string; At: Date }[] = [];
  let Running = 0;
  let LastPaymentId: number | null = null;
  let PaymentTotal = 0;
  for (const Row of Rows) {
    const Delta = ToPiasters(Row.Amount);
    Running += Delta;
    if (Row.Type === "Payment" && Row.CreditPaymentId === LastPaymentId) {
      PaymentTotal += -Delta;
      Object.assign(Entries[Entries.length - 1], { Amount: FromPiasters(PaymentTotal), Balance: FromPiasters(Running) });
      continue;
    }
    LastPaymentId = Row.Type === "Payment" ? Row.CreditPaymentId : null;
    PaymentTotal = Row.Type === "Payment" ? -Delta : 0;
    Entries.push({
      Type: Row.Type,
      OrderId: Row.Type === "Payment" ? null : Row.OrderId,
      Amount: FromPiasters(Math.abs(Delta)),
      Balance: FromPiasters(Running),
      At: Row.CreatedAt,
    });
  }
  const Account = await AccountView(Db, CustomerId);
  return { CustomerId, Limit: Account.Limit, Balance: Account.Balance, Entries };
}

export async function WriteOff(CompanyId: number, Role: string, OrderId: number) {
  if (Role !== "Owner") throw new AppError(403, "FORBIDDEN", "Only the owner can write off debts");
  return Db.transaction(async (Tx) => {
    const Order = await LockOrder(Tx, CompanyId, OrderId);
    if (Order.Status !== "OnCredit") throw new AppError(409, "INVALID_STATUS", "Only open credit orders can be written off");
    await FindCustomer(Tx, CompanyId, Order.CustomerId, true);
    const Remaining = await OrderRemaining(Tx, OrderId);
    if (Remaining <= 0) throw new AppError(409, "INVALID_STATUS", "Nothing left to write off");
    await Tx.insert(CreditEntries).values({ CompanyId, CustomerId: Order.CustomerId, OrderId, Type: "WriteOff", Amount: FromPiasters(-Remaining), CreatedAt: Now() });
    await Tx.update(Orders).set({ Status: "WrittenOff" }).where(eq(Orders.Id, OrderId));
    return { OrderId, Status: "WrittenOff", Amount: FromPiasters(Remaining), ...(await AccountView(Tx, Order.CustomerId)) };
  });
}

export async function ReverseCreditOnCancel(Tx: Transaction, CompanyId: number, Order: typeof Orders.$inferSelect) {
  const [Paid] = await Tx.select({ Id: CreditEntries.Id })
    .from(CreditEntries)
    .where(and(eq(CreditEntries.OrderId, Order.Id), sql`${CreditEntries.Type} <> 'Purchase'`))
    .limit(1);
  if (Paid) throw new AppError(409, "INVALID_STATUS", "Part of this credit order is already settled");
  const Remaining = await OrderRemaining(Tx, Order.Id);
  await Tx.insert(CreditEntries).values({ CompanyId, CustomerId: Order.CustomerId, OrderId: Order.Id, Type: "Cancellation", Amount: FromPiasters(-Remaining), CreatedAt: Now() });
}

const DebtRows = (CompanyId: number, Cutoff?: Date) => sql`
  SELECT e."OrderId", e."CustomerId",
    ((min(e."CreatedAt") FILTER (WHERE e."Type" = 'Purchase')) AT TIME ZONE 'UTC')::date + ${DueDays}::int AS "DueDate",
    sum(e."Amount")::text AS "Remaining"
  FROM "CreditEntries" e
  WHERE e."CompanyId" = ${CompanyId} ${Cutoff ? sql`AND e."CreatedAt" < ${Cutoff.toISOString()}::timestamptz` : sql``}
  GROUP BY e."OrderId", e."CustomerId"
  HAVING sum(e."Amount") > 0`;

function DateText(Value: unknown) {
  return Value instanceof Date ? Value.toISOString().slice(0, 10) : String(Value).slice(0, 10);
}

function DaysBetween(From: string, To: string) {
  return Math.round((Date.parse(`${To}T00:00:00Z`) - Date.parse(`${From}T00:00:00Z`)) / DayMs);
}

export async function OverdueCredit(CompanyId: number, Page: number, PageSize: number) {
  const Today = Now().toISOString().slice(0, 10);
  const Result = await Db.execute<{ OrderId: number; DueDate: unknown; Remaining: string; CustomerId: number; Name: string; Phone: string | null; Total: number }>(sql`
    SELECT d."OrderId", d."DueDate", d."Remaining", c."Id" AS "CustomerId", c."Name", c."Phone", count(*) OVER ()::int AS "Total"
    FROM (${DebtRows(CompanyId)}) d
    JOIN "Customers" c ON c."Id" = d."CustomerId"
    WHERE d."DueDate" < ${Today}::date
    ORDER BY d."DueDate" ASC, d."OrderId" ASC
    LIMIT ${PageSize} OFFSET ${(Page - 1) * PageSize}`);
  let Total = Result.rows[0]?.Total;
  if (Total === undefined) {
    const Count = await Db.execute<{ N: number }>(sql`SELECT count(*)::int AS "N" FROM (${DebtRows(CompanyId)}) d WHERE d."DueDate" < ${Today}::date`);
    Total = Count.rows[0].N;
  }
  const Items = Result.rows.map((R) => {
    const DueDate = DateText(R.DueDate);
    return {
      OrderId: R.OrderId,
      DueDate,
      Remaining: FromPiasters(ToPiasters(R.Remaining)),
      DaysOverdue: DaysBetween(DueDate, Today),
      Customer: { Id: R.CustomerId, Name: R.Name, Phone: R.Phone },
    };
  });
  return { Items, ...PageMeta(Page, PageSize, Total) };
}

const Buckets = ["NotDue", "Days1To30", "Days31To60", "Days61To90", "Over90"] as const;
type Bucket = (typeof Buckets)[number];

function BucketOf(Days: number): Bucket {
  if (Days <= 0) return "NotDue";
  if (Days <= 30) return "Days1To30";
  if (Days <= 60) return "Days31To60";
  if (Days <= 90) return "Days61To90";
  return "Over90";
}

function Format(Sums: Record<Bucket | "Total", number>) {
  return Object.fromEntries(Object.entries(Sums).map(([K, V]) => [K, FromPiasters(V)])) as Record<Bucket | "Total", string>;
}

const Empty = () => ({ NotDue: 0, Days1To30: 0, Days31To60: 0, Days61To90: 0, Over90: 0, Total: 0 });

export async function CreditAging(CompanyId: number, Month: string) {
  const [Year, M] = Month.split("-").map(Number);
  const Cutoff = new Date(Date.UTC(Year, M, 1));
  const AsOf = new Date(Cutoff.getTime() - DayMs).toISOString().slice(0, 10);
  const Result = await Db.execute<{ DueDate: unknown; Remaining: string; CustomerId: number; Name: string; Phone: string | null }>(sql`
    SELECT d."DueDate", d."Remaining", c."Id" AS "CustomerId", c."Name", c."Phone"
    FROM (${DebtRows(CompanyId, Cutoff)}) d
    JOIN "Customers" c ON c."Id" = d."CustomerId"`);
  const ByCustomer = new Map<number, { Customer: { Id: number; Name: string; Phone: string | null }; Sums: ReturnType<typeof Empty> }>();
  const Totals = Empty();
  for (const R of Result.rows) {
    const Amount = ToPiasters(R.Remaining);
    const Key = BucketOf(DaysBetween(DateText(R.DueDate), AsOf));
    const Row = ByCustomer.get(R.CustomerId) ?? { Customer: { Id: R.CustomerId, Name: R.Name, Phone: R.Phone }, Sums: Empty() };
    Row.Sums[Key] += Amount;
    Row.Sums.Total += Amount;
    Totals[Key] += Amount;
    Totals.Total += Amount;
    ByCustomer.set(R.CustomerId, Row);
  }
  const Items = [...ByCustomer.values()]
    .sort((A, B) => B.Sums.Total - A.Sums.Total || A.Customer.Id - B.Customer.Id)
    .map((R) => ({ Customer: R.Customer, ...Format(R.Sums) }));
  return { Month, Items, Totals: Format(Totals) };
}
