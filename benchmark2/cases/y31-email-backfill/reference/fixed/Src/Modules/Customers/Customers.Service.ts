import { and, count, desc, eq, ne } from "drizzle-orm";
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

export function NormalizeEmail(Email: string | null | undefined) {
  const Value = (Email ?? "").trim().toLowerCase();
  return Value === "" ? null : Value;
}

async function EnsureEmailFree(CompanyId: number, EmailNormalized: string | null, ExceptId?: number) {
  if (!EmailNormalized) return;
  const Conditions = [eq(Customers.CompanyId, CompanyId), eq(Customers.EmailNormalized, EmailNormalized)];
  if (ExceptId) Conditions.push(ne(Customers.Id, ExceptId));
  const [Taken] = await Db.select({ Id: Customers.Id }).from(Customers).where(and(...Conditions)).limit(1);
  if (Taken) throw new AppError(409, "EMAIL_TAKEN", "Another customer already uses this email");
}

export async function LookupByEmail(CompanyId: number, Email: string) {
  const EmailNormalized = NormalizeEmail(Email);
  if (!EmailNormalized) throw new AppError(400, "VALIDATION_ERROR", "Email is required");
  return Db.select().from(Customers).where(and(eq(Customers.CompanyId, CompanyId), eq(Customers.EmailNormalized, EmailNormalized))).orderBy(Customers.Id);
}

export async function CreateCustomer(CompanyId: number, Input: { Name: string; Phone?: string; Email?: string }) {
  const EmailNormalized = NormalizeEmail(Input.Email);
  await EnsureEmailFree(CompanyId, EmailNormalized);
  const [Customer] = await Db.insert(Customers).values({ CompanyId, ...Input, EmailNormalized }).returning();
  return Customer;
}

export async function UpdateCustomer(CompanyId: number, Id: number, Input: { Name?: string; Phone?: string; Email?: string }) {
  const Changes: Partial<typeof Customers.$inferInsert> = { ...Input };
  if (Input.Email !== undefined) {
    Changes.EmailNormalized = NormalizeEmail(Input.Email);
    await EnsureEmailFree(CompanyId, Changes.EmailNormalized, Id);
  }
  const [Customer] = await Db.update(Customers)
    .set(Changes)
    .where(and(eq(Customers.Id, Id), eq(Customers.CompanyId, CompanyId)))
    .returning();
  if (!Customer) throw new AppError(404, "NOT_FOUND", "Customer not found");
  return Customer;
}
