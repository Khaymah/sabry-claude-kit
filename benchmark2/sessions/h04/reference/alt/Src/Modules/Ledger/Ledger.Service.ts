import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { Db, type Transaction } from "../../Database/Db";
import { CreditLimitLog, CreditReceipts, Customers, Orders, Payments } from "../../Database/Schema";
import { AppError } from "../../Lib/Response";
import { Now } from "../../Lib/Clock";
import { FromPiasters, ToPiasters } from "../../Lib/Money";
import { PageMeta } from "../../Lib/Pagination";

type Executor = Transaction | typeof Db;
type Order = typeof Orders.$inferSelect;
type Receipt = typeof CreditReceipts.$inferSelect;
type Repayment = { OrderId: number; ReceiptId: number; Amount: number; At: Date };

const DayMs = 86400_000;
const Money = (Value: string | null) => (Value === null ? 0 : ToPiasters(Value));

async function CustomerRow(Ex: Executor, CompanyId: number, CustomerId: number) {
  const [Row] = await Ex.select().from(Customers).where(and(eq(Customers.Id, CustomerId), eq(Customers.CompanyId, CompanyId)));
  if (!Row) throw new AppError(404, "NOT_FOUND", "Customer not found");
  return Row;
}

function View(Row: typeof Customers.$inferSelect) {
  const Limit = Money(Row.CreditLimit);
  const Balance = Money(Row.CreditBalance);
  return { CustomerId: Row.Id, Limit: FromPiasters(Limit), Balance: FromPiasters(Balance), Available: FromPiasters(Math.max(0, Limit - Balance)) };
}

export async function Account(CompanyId: number, CustomerId: number) {
  return View(await CustomerRow(Db, CompanyId, CustomerId));
}

export async function ChangeLimit(Auth: { CompanyId: number; UserId: number; Role: string }, CustomerId: number, Limit: string) {
  if (Auth.Role !== "Owner") throw new AppError(403, "FORBIDDEN", "Only the owner can change credit limits");
  return Db.transaction(async (Tx) => {
    const Before = await CustomerRow(Tx, Auth.CompanyId, CustomerId);
    const [After] = await Tx.update(Customers).set({ CreditLimit: FromPiasters(ToPiasters(Limit)) }).where(eq(Customers.Id, CustomerId)).returning();
    await Tx.insert(CreditLimitLog).values({
      CompanyId: Auth.CompanyId,
      CustomerId,
      OldLimit: Before.CreditLimit,
      NewLimit: After.CreditLimit,
      UserId: Auth.UserId,
      CreatedAt: Now(),
    });
    return View(After);
  });
}

export async function LimitLog(CompanyId: number, CustomerId: number) {
  await CustomerRow(Db, CompanyId, CustomerId);
  const Rows = await Db.select()
    .from(CreditLimitLog)
    .where(and(eq(CreditLimitLog.CompanyId, CompanyId), eq(CreditLimitLog.CustomerId, CustomerId)))
    .orderBy(desc(CreditLimitLog.Id));
  return Rows.map((R) => ({ OldLimit: R.OldLimit, NewLimit: R.NewLimit, ChangedByUserId: R.UserId, ChangedAt: R.CreatedAt }));
}

async function Repaid(Ex: Executor, OrderId: number) {
  const [{ Sum }] = await Ex.select({ Sum: sql<string>`coalesce(sum(${Payments.Amount}), 0)::text` })
    .from(Payments)
    .where(and(eq(Payments.OrderId, OrderId), isNotNull(Payments.ReceiptId)));
  return ToPiasters(Sum);
}

async function Move(Tx: Transaction, CustomerId: number, Delta: number, Guard: "Limit" | "NonNegative") {
  const Check =
    Guard === "Limit"
      ? sql`${Customers.CreditBalance} + ${FromPiasters(Delta)}::numeric <= ${Customers.CreditLimit}`
      : sql`${Customers.CreditBalance} + ${FromPiasters(Delta)}::numeric >= 0`;
  const [Row] = await Tx.update(Customers)
    .set({ CreditBalance: sql`${Customers.CreditBalance} + ${FromPiasters(Delta)}::numeric` })
    .where(and(eq(Customers.Id, CustomerId), Check))
    .returning();
  return Row;
}

export async function Charge(CompanyId: number, OrderId: number) {
  return Db.transaction(async (Tx) => {
    const [Order] = await Tx.select().from(Orders).where(and(eq(Orders.Id, OrderId), eq(Orders.CompanyId, CompanyId)));
    if (!Order) throw new AppError(404, "NOT_FOUND", "Order not found");
    if (Order.Status !== "Pending") throw new AppError(409, "INVALID_STATUS", "Only pending orders can go on credit");
    const [{ Paid }] = await Tx.select({ Paid: sql<string>`coalesce(sum(${Payments.Amount}), 0)::text` })
      .from(Payments)
      .where(and(eq(Payments.OrderId, OrderId), eq(Payments.Status, "Completed")));
    const Amount = ToPiasters(Order.Total) - ToPiasters(Paid);
    if (Amount <= 0) throw new AppError(409, "NOTHING_TO_CHARGE", "Nothing left to charge");
    const [Claimed] = await Tx.update(Orders)
      .set({ Status: "OnCredit", CreditAmount: FromPiasters(Amount), CreditAt: Now() })
      .where(and(eq(Orders.Id, OrderId), eq(Orders.Status, "Pending")))
      .returning();
    if (!Claimed) throw new AppError(409, "INVALID_STATUS", "Order is no longer pending");
    const Customer = await Move(Tx, Order.CustomerId, Amount, "Limit");
    if (!Customer) throw new AppError(409, "CREDIT_LIMIT_EXCEEDED", "Credit limit exceeded");
    return View(Customer);
  });
}

async function ReceiptResult(Ex: Executor, Receipt: Receipt) {
  const Parts = await Ex.select({ OrderId: Payments.OrderId, Amount: Payments.Amount }).from(Payments).where(eq(Payments.ReceiptId, Receipt.Id)).orderBy(asc(Payments.Id));
  const [Customer] = await Ex.select().from(Customers).where(eq(Customers.Id, Receipt.CustomerId));
  return { ReceiptId: Receipt.Id, Amount: Receipt.Amount, Allocations: Parts, Balance: View(Customer).Balance };
}

export async function Repay(CompanyId: number, CustomerId: number, Input: { Amount: string; Method: string; RequestId: string }) {
  const Amount = ToPiasters(Input.Amount);
  if (Amount <= 0) throw new AppError(400, "VALIDATION_ERROR", "Amount must be positive");
  await CustomerRow(Db, CompanyId, CustomerId);
  return Db.transaction(async (Tx) => {
    const At = Now();
    const [Receipt] = await Tx.insert(CreditReceipts)
      .values({ CompanyId, CustomerId, RequestKey: Input.RequestId, Amount: FromPiasters(Amount), Method: Input.Method, CreatedAt: At })
      .onConflictDoNothing()
      .returning();
    if (!Receipt) {
      const [Existing] = await Tx.select().from(CreditReceipts).where(and(eq(CreditReceipts.CompanyId, CompanyId), eq(CreditReceipts.RequestKey, Input.RequestId)));
      return ReceiptResult(Tx, Existing);
    }
    if (!(await Move(Tx, CustomerId, -Amount, "NonNegative"))) throw new AppError(409, "OVERPAYMENT", "Amount exceeds the customer's debt");
    const Open = await Tx.select()
      .from(Orders)
      .where(and(eq(Orders.CompanyId, CompanyId), eq(Orders.CustomerId, CustomerId), eq(Orders.Status, "OnCredit")))
      .orderBy(asc(Orders.CreditAt), asc(Orders.Id));
    let Left = Amount;
    for (const Order of Open) {
      if (Left === 0) break;
      const Remaining = Money(Order.CreditAmount) - (await Repaid(Tx, Order.Id));
      const Part = Math.min(Left, Remaining);
      if (Part <= 0) continue;
      await Tx.insert(Payments).values({ CompanyId, OrderId: Order.Id, Amount: FromPiasters(Part), Method: Input.Method, ReceiptId: Receipt.Id, CreatedAt: At });
      if (Part === Remaining) await Tx.update(Orders).set({ Status: "Paid", ClosedAt: At }).where(eq(Orders.Id, Order.Id));
      Left -= Part;
    }
    return ReceiptResult(Tx, Receipt);
  });
}

export async function WriteOff(Auth: { CompanyId: number; Role: string }, OrderId: number) {
  if (Auth.Role !== "Owner") throw new AppError(403, "FORBIDDEN", "Only the owner can write off debts");
  return Db.transaction(async (Tx) => {
    const [Order] = await Tx.select().from(Orders).where(and(eq(Orders.Id, OrderId), eq(Orders.CompanyId, Auth.CompanyId)));
    if (!Order) throw new AppError(404, "NOT_FOUND", "Order not found");
    const [Closed] = await Tx.update(Orders)
      .set({ Status: "WrittenOff", ClosedAt: Now() })
      .where(and(eq(Orders.Id, OrderId), eq(Orders.Status, "OnCredit")))
      .returning();
    if (!Closed) throw new AppError(409, "INVALID_STATUS", "Only open credit orders can be written off");
    const Remaining = Money(Order.CreditAmount) - (await Repaid(Tx, OrderId));
    const Customer = await Move(Tx, Order.CustomerId, -Remaining, "NonNegative");
    return { OrderId, Status: Closed.Status, WrittenOff: FromPiasters(Remaining), ...View(Customer) };
  });
}

export async function CancelCreditOrder(Tx: Transaction, Order: Order) {
  if ((await Repaid(Tx, Order.Id)) > 0) throw new AppError(409, "PARTLY_PAID", "Part of this credit order is already paid");
  const [Closed] = await Tx.update(Orders)
    .set({ Status: "Cancelled", ClosedAt: Now() })
    .where(and(eq(Orders.Id, Order.Id), eq(Orders.Status, "OnCredit")))
    .returning();
  if (!Closed) throw new AppError(409, "INVALID_STATUS", "Order is no longer on credit");
  await Move(Tx, Order.CustomerId, -Money(Order.CreditAmount), "NonNegative");
  return Closed;
}

async function History(CompanyId: number, CustomerIds?: number[]) {
  const Scope = CustomerIds ? and(eq(Orders.CompanyId, CompanyId), inArray(Orders.CustomerId, CustomerIds)) : eq(Orders.CompanyId, CompanyId);
  const CreditOrders = await Db.select().from(Orders).where(and(Scope, isNotNull(Orders.CreditAt)));
  const Ids = CreditOrders.map((O) => O.Id);
  const Rows = Ids.length
    ? await Db.select({ OrderId: Payments.OrderId, ReceiptId: Payments.ReceiptId, Amount: Payments.Amount, At: Payments.CreatedAt })
        .from(Payments)
        .where(and(inArray(Payments.OrderId, Ids), isNotNull(Payments.ReceiptId)))
    : [];
  const Repayments: Repayment[] = Rows.map((R) => ({ OrderId: R.OrderId, ReceiptId: R.ReceiptId!, Amount: ToPiasters(R.Amount), At: R.At }));
  return { CreditOrders, Repayments };
}

function OpenAt(Order: Order, Repayments: Repayment[], Cutoff: number) {
  if (!Order.CreditAt || Order.CreditAt.getTime() >= Cutoff) return 0;
  if ((Order.Status === "WrittenOff" || Order.Status === "Cancelled") && Order.ClosedAt && Order.ClosedAt.getTime() < Cutoff) return 0;
  const Paid = Repayments.filter((R) => R.OrderId === Order.Id && R.At.getTime() < Cutoff).reduce((S, R) => S + R.Amount, 0);
  return Money(Order.CreditAmount) - Paid;
}

function DueDate(Order: Order) {
  const D = new Date(`${Order.CreditAt!.toISOString().slice(0, 10)}T00:00:00Z`);
  return new Date(D.getTime() + 30 * DayMs).toISOString().slice(0, 10);
}

const Days = (From: string, To: string) => Math.round((Date.parse(`${To}T00:00:00Z`) - Date.parse(`${From}T00:00:00Z`)) / DayMs);

export async function CustomerStatement(CompanyId: number, CustomerId: number) {
  const Customer = await CustomerRow(Db, CompanyId, CustomerId);
  const { CreditOrders, Repayments } = await History(CompanyId, [CustomerId]);
  const Receipts = await Db.select().from(CreditReceipts).where(and(eq(CreditReceipts.CompanyId, CompanyId), eq(CreditReceipts.CustomerId, CustomerId)));
  const Applied = new Set(Repayments.map((R) => R.ReceiptId));
  const Events: { At: Date; Rank: number; Seq: number; Type: string; OrderId: number | null; Delta: number }[] = [];
  for (const O of CreditOrders) {
    Events.push({ At: O.CreditAt!, Rank: 0, Seq: O.Id, Type: "Purchase", OrderId: O.Id, Delta: Money(O.CreditAmount) });
    if ((O.Status === "WrittenOff" || O.Status === "Cancelled") && O.ClosedAt) {
      const Paid = Repayments.filter((R) => R.OrderId === O.Id).reduce((S, R) => S + R.Amount, 0);
      Events.push({ At: O.ClosedAt, Rank: 2, Seq: O.Id, Type: O.Status === "WrittenOff" ? "WriteOff" : "Cancellation", OrderId: O.Id, Delta: -(Money(O.CreditAmount) - Paid) });
    }
  }
  for (const R of Receipts) if (Applied.has(R.Id)) Events.push({ At: R.CreatedAt, Rank: 1, Seq: R.Id, Type: "Payment", OrderId: null, Delta: -Money(R.Amount) });
  Events.sort((X, Y) => X.At.getTime() - Y.At.getTime() || X.Rank - Y.Rank || X.Seq - Y.Seq);
  let Running = 0;
  const Entries = Events.map((E) => {
    Running += E.Delta;
    return { Type: E.Type, OrderId: E.OrderId, Amount: FromPiasters(Math.abs(E.Delta)), Balance: FromPiasters(Running), At: E.At };
  });
  const Current = View(Customer);
  return { CustomerId, Limit: Current.Limit, Balance: Current.Balance, Entries };
}

async function CustomerCards(CompanyId: number, Ids: number[]) {
  if (!Ids.length) return new Map<number, { Id: number; Name: string; Phone: string | null }>();
  const Rows = await Db.select({ Id: Customers.Id, Name: Customers.Name, Phone: Customers.Phone })
    .from(Customers)
    .where(and(eq(Customers.CompanyId, CompanyId), inArray(Customers.Id, Ids)));
  return new Map(Rows.map((R) => [R.Id, R]));
}

export async function Overdue(CompanyId: number, Page: number, PageSize: number) {
  const Today = Now().toISOString().slice(0, 10);
  const { CreditOrders, Repayments } = await History(CompanyId);
  const Late = CreditOrders.filter((O) => O.Status === "OnCredit")
    .map((O) => ({ Order: O, DueDate: DueDate(O), Remaining: OpenAt(O, Repayments, Infinity) }))
    .filter((R) => R.Remaining > 0 && R.DueDate < Today)
    .sort((X, Y) => X.DueDate.localeCompare(Y.DueDate) || X.Order.Id - Y.Order.Id);
  const Slice = Late.slice((Page - 1) * PageSize, Page * PageSize);
  const Cards = await CustomerCards(CompanyId, [...new Set(Slice.map((R) => R.Order.CustomerId))]);
  const Items = Slice.map((R) => ({
    OrderId: R.Order.Id,
    DueDate: R.DueDate,
    Remaining: FromPiasters(R.Remaining),
    DaysOverdue: Days(R.DueDate, Today),
    Customer: Cards.get(R.Order.CustomerId)!,
  }));
  return { Items, ...PageMeta(Page, PageSize, Late.length) };
}

const Columns = ["NotDue", "Days1To30", "Days31To60", "Days61To90", "Over90"] as const;

function Column(Late: number) {
  return Late <= 0 ? 0 : Late <= 30 ? 1 : Late <= 60 ? 2 : Late <= 90 ? 3 : 4;
}

function Render(Values: number[]) {
  const Out: Record<string, string> = {};
  Columns.forEach((C, I) => (Out[C] = FromPiasters(Values[I])));
  Out.Total = FromPiasters(Values.reduce((S, V) => S + V, 0));
  return Out;
}

export async function Aging(CompanyId: number, Month: string) {
  const [Y, M] = Month.split("-").map(Number);
  const Cutoff = Date.UTC(Y, M, 1);
  const AsOf = new Date(Cutoff - DayMs).toISOString().slice(0, 10);
  const { CreditOrders, Repayments } = await History(CompanyId);
  const Per = new Map<number, number[]>();
  const All = [0, 0, 0, 0, 0];
  for (const O of CreditOrders) {
    const Open = OpenAt(O, Repayments, Cutoff);
    if (Open <= 0) continue;
    const Index = Column(Days(DueDate(O), AsOf));
    const Values = Per.get(O.CustomerId) ?? [0, 0, 0, 0, 0];
    Values[Index] += Open;
    All[Index] += Open;
    Per.set(O.CustomerId, Values);
  }
  const Cards = await CustomerCards(CompanyId, [...Per.keys()]);
  const Sum = (V: number[]) => V.reduce((S, X) => S + X, 0);
  const Items = [...Per.entries()]
    .sort(([IdA, A], [IdB, B]) => Sum(B) - Sum(A) || IdA - IdB)
    .map(([Id, Values]) => ({ Customer: Cards.get(Id)!, ...Render(Values) }));
  return { Month, Items, Totals: Render(All) };
}
