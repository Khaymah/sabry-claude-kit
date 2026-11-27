import { and, count, desc, eq, sql } from "drizzle-orm";
import { Db } from "../../Database/Db";
import { Customers, LoyaltyLedger } from "../../Database/Schema";
import { AppError } from "../../Lib/Response";
import { PageMeta } from "../../Lib/Pagination";

export async function ListCustomers(CompanyId: number, Page: number, PageSize: number) {
  const Where = eq(Customers.CompanyId, CompanyId);
  const Items = await Db.select()
    .from(Customers)
    .where(Where)
    .orderBy(desc(Customers.CreatedAt), desc(Customers.Id))
    .limit(PageSize)
    .offset((Page - 1) * PageSize);
  const [{ Total }] = await Db.select({ Total: count() }).from(Customers).where(Where);
  return { Items, ...PageMeta(Page, PageSize, Total) };
}

export async function GetCustomer(CompanyId: number, Id: number) {
  const [Customer] = await Db.select()
    .from(Customers)
    .where(and(eq(Customers.Id, Id), eq(Customers.CompanyId, CompanyId)));
  if (!Customer) throw new AppError(404, "NOT_FOUND", "Customer not found");
  return Customer;
}

export async function CreateCustomer(CompanyId: number, Input: { Name: string; Phone?: string; Email?: string }) {
  const [Customer] = await Db.insert(Customers).values({ CompanyId, ...Input }).returning();
  return Customer;
}

export async function UpdateCustomer(CompanyId: number, Id: number, Input: { Name?: string; Phone?: string; Email?: string }) {
  const [Customer] = await Db.update(Customers)
    .set(Input)
    .where(and(eq(Customers.Id, Id), eq(Customers.CompanyId, CompanyId)))
    .returning();
  if (!Customer) throw new AppError(404, "NOT_FOUND", "Customer not found");
  return Customer;
}

async function Balance(Executor: Pick<typeof Db, "select">, CustomerId: number) {
  const [Row] = await Executor.select({ Points: sql<number>`coalesce(sum(${LoyaltyLedger.Points}), 0)::int` }).from(LoyaltyLedger).where(eq(LoyaltyLedger.CustomerId, CustomerId));
  return Row.Points;
}

export async function GetLoyalty(CompanyId: number, Id: number) {
  const Customer = await GetCustomer(CompanyId, Id);
  return { Points: await Balance(Db, Id), WalletBalance: Customer.WalletBalance };
}

export async function RedeemPoints(CompanyId: number, Id: number, Points: number) {
  return Db.transaction(async (Tx) => {
    const [Customer] = await Tx.select().from(Customers).where(and(eq(Customers.Id, Id), eq(Customers.CompanyId, CompanyId))).for("update");
    if (!Customer) throw new AppError(404, "NOT_FOUND", "Customer not found");
    const Have = await Balance(Tx, Id);
    if (Have < Points) throw new AppError(409, "NOT_ENOUGH_POINTS", "Not enough points");
    await Tx.insert(LoyaltyLedger).values({ CustomerId: Id, Points: -Points, Reason: "Redeemed" });
    const [Updated] = await Tx.update(Customers)
      .set({ WalletBalance: sql`${Customers.WalletBalance} + ${(Points / 10).toFixed(2)}::numeric` })
      .where(eq(Customers.Id, Id))
      .returning({ WalletBalance: Customers.WalletBalance });
    return { Points: Have - Points, WalletBalance: Updated.WalletBalance };
  });
}
