import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import { Db, type Transaction } from "../../Database/Db";
import { Customers, Installments, Orders, Payments } from "../../Database/Schema";
import { AppError } from "../../Lib/Response";
import { Now } from "../../Lib/Clock";
import { FromPiasters, ToPiasters } from "../../Lib/Money";
import { PageMeta } from "../../Lib/Pagination";
import { GetCustomer } from "../Customers/Customers.Service";

function AddMonths(Start: Date, Months: number) {
  const D = new Date(Date.UTC(Start.getUTCFullYear(), Start.getUTCMonth() + Months, 1));
  const Last = new Date(Date.UTC(D.getUTCFullYear(), D.getUTCMonth() + 1, 0)).getUTCDate();
  D.setUTCDate(Math.min(Start.getUTCDate(), Last));
  return D.toISOString().slice(0, 10);
}

function Split(Total: number, Count: number) {
  const Base = Math.floor(Total / Count);
  return Array.from({ length: Count }, (_, I) => Base + (I < Total - Base * Count ? 1 : 0));
}

async function LockOrder(Tx: Transaction, CompanyId: number, OrderId: number) {
  const [Order] = await Tx.select().from(Orders).where(and(eq(Orders.Id, OrderId), eq(Orders.CompanyId, CompanyId))).for("update");
  if (!Order) throw new AppError(404, "NOT_FOUND", "Order not found");
  return Order;
}

async function Unpaid(Tx: Transaction, Order: typeof Orders.$inferSelect) {
  const [{ Paid }] = await Tx.select({ Paid: sql<string>`coalesce(sum(${Payments.Amount}), 0)::text` })
    .from(Payments)
    .where(and(eq(Payments.OrderId, Order.Id), eq(Payments.Status, "Completed")));
  return ToPiasters(Order.Total) - ToPiasters(Paid);
}

export async function GetPlan(CompanyId: number, OrderId: number) {
  const [Order] = await Db.select({ Id: Orders.Id }).from(Orders).where(and(eq(Orders.Id, OrderId), eq(Orders.CompanyId, CompanyId)));
  if (!Order) throw new AppError(404, "NOT_FOUND", "Order not found");
  const Rows = await Db.select().from(Installments).where(eq(Installments.OrderId, OrderId)).orderBy(asc(Installments.No));
  return { OrderId, Installments: Rows };
}

export async function CreatePlan(CompanyId: number, OrderId: number, Count: number) {
  await Db.transaction(async (Tx) => {
    const Order = await LockOrder(Tx, CompanyId, OrderId);
    if (Order.Status !== "Pending") throw new AppError(409, "INVALID_STATUS", "Only pending orders can be split");
    const [Existing] = await Tx.select({ Id: Installments.Id }).from(Installments).where(eq(Installments.OrderId, OrderId)).limit(1);
    if (Existing) throw new AppError(409, "PLAN_EXISTS", "This order already has an installment plan");
    const Left = await Unpaid(Tx, Order);
    if (Left < Count) throw new AppError(409, "NOTHING_TO_SPLIT", "Nothing left to split");
    const Today = Now();
    await Tx.insert(Installments).values(Split(Left, Count).map((Amount, I) => ({ CompanyId, OrderId, No: I + 1, DueDate: AddMonths(Today, I), Amount: FromPiasters(Amount) })));
  });
  return GetPlan(CompanyId, OrderId);
}

export async function Replan(CompanyId: number, OrderId: number, Count: number) {
  await Db.transaction(async (Tx) => {
    const Order = await LockOrder(Tx, CompanyId, OrderId);
    const Rows = await Tx.select().from(Installments).where(eq(Installments.OrderId, OrderId)).orderBy(asc(Installments.No));
    if (Rows.length === 0) throw new AppError(404, "NOT_FOUND", "This order has no installment plan");
    if (Order.Status !== "Pending" || Rows.every((R) => R.Status === "Paid")) throw new AppError(409, "INVALID_STATUS", "The plan is already paid");
    const Left = await Unpaid(Tx, Order);
    await Tx.delete(Installments).where(and(eq(Installments.OrderId, OrderId), eq(Installments.Status, "Due")));
    const NextNo = Math.max(0, ...Rows.filter((R) => R.Status === "Paid").map((R) => R.No)) + 1;
    const Today = Now();
    await Tx.insert(Installments).values(Split(Left, Count).map((Amount, I) => ({ CompanyId, OrderId, No: NextNo + I, DueDate: AddMonths(Today, I), Amount: FromPiasters(Amount) })));
  });
  return GetPlan(CompanyId, OrderId);
}

export async function PayInstallment(CompanyId: number, OrderId: number, No: number, Method: string) {
  return Db.transaction(async (Tx) => {
    const Order = await LockOrder(Tx, CompanyId, OrderId);
    const [Item] = await Tx.select().from(Installments).where(and(eq(Installments.OrderId, OrderId), eq(Installments.No, No)));
    if (!Item) throw new AppError(404, "NOT_FOUND", "Installment not found");
    if (Item.Status !== "Due" || Order.Status !== "Pending") throw new AppError(409, "ALREADY_PAID", "This installment is already paid");
    const Amount = ToPiasters(Item.Amount);
    if (Amount > (await Unpaid(Tx, Order))) throw new AppError(409, "OVERPAYMENT", "Amount exceeds the remaining balance");
    const [Payment] = await Tx.insert(Payments).values({ CompanyId, OrderId, Amount: Item.Amount, Method }).returning();
    await Tx.update(Installments).set({ Status: "Paid", PaymentId: Payment.Id }).where(eq(Installments.Id, Item.Id));
    if ((await Unpaid(Tx, Order)) === 0) await Tx.update(Orders).set({ Status: "Paid" }).where(eq(Orders.Id, OrderId));
    return { Payment, Installment: { ...Item, Status: "Paid", PaymentId: Payment.Id } };
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
  const Where = and(eq(Installments.CompanyId, CompanyId), eq(Installments.Status, "Due"), sql`${Installments.DueDate} < ${Today}::date`);
  const Items = await Db.select({
    OrderId: Installments.OrderId,
    No: Installments.No,
    DueDate: Installments.DueDate,
    Amount: Installments.Amount,
    CustomerName: Customers.Name,
    CustomerPhone: Customers.Phone,
  })
    .from(Installments)
    .innerJoin(Orders, eq(Orders.Id, Installments.OrderId))
    .innerJoin(Customers, eq(Customers.Id, Orders.CustomerId))
    .where(Where)
    .orderBy(asc(Installments.DueDate), asc(Installments.OrderId), asc(Installments.No))
    .limit(PageSize)
    .offset((Page - 1) * PageSize);
  const [{ Total }] = await Db.select({ Total: count() }).from(Installments).where(Where);
  return { Items, ...PageMeta(Page, PageSize, Total) };
}
