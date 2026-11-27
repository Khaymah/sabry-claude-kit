import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import { Db } from "../../Database/Db";
import { Customers } from "../../Database/Schema";
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

export async function GetLoyalty(CompanyId: number, Id: number) {
  const Customer = await GetCustomer(CompanyId, Id);
  return { Points: Customer.LoyaltyPoints, WalletBalance: Customer.WalletBalance };
}

export async function RedeemPoints(CompanyId: number, Id: number, Points: number) {
  const Credit = ((Points / 100) * 10).toFixed(2);
  const [Row] = await Db.update(Customers)
    .set({
      LoyaltyPoints: sql`${Customers.LoyaltyPoints} - ${Points}`,
      WalletBalance: sql`${Customers.WalletBalance} + ${Credit}::numeric`,
    })
    .where(and(eq(Customers.Id, Id), eq(Customers.CompanyId, CompanyId), gte(Customers.LoyaltyPoints, Points)))
    .returning({ Points: Customers.LoyaltyPoints, WalletBalance: Customers.WalletBalance });
  if (Row) return Row;
  await GetCustomer(CompanyId, Id);
  throw new AppError(409, "INSUFFICIENT_POINTS", "Not enough points");
}
