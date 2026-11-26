import { and, count, desc, eq } from "drizzle-orm";
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

export async function CreateCustomer(CompanyId: number, Input: { Name: string; Phone?: string; Email?: string; Notes?: string }) {
  const [Customer] = await Db.insert(Customers).values({ CompanyId, ...Input }).returning();
  return Customer;
}

export async function UpdateCustomer(CompanyId: number, Id: number, Input: { Name?: string; Phone?: string; Email?: string; Notes?: string }) {
  const [Customer] = await Db.update(Customers)
    .set(Input)
    .where(and(eq(Customers.Id, Id), eq(Customers.CompanyId, CompanyId)))
    .returning();
  if (!Customer) throw new AppError(404, "NOT_FOUND", "Customer not found");
  return Customer;
}
