import { and, count, desc, eq, ne } from "drizzle-orm";
import { Db } from "../../Database/Db";
import { Customers } from "../../Database/Schema";
import { AppError } from "../../Lib/Response";
import { PageMeta } from "../../Lib/Pagination";
import { NormalizeEgyptianPhone } from "../../Lib/Phone";

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

async function EnsurePhoneFree(CompanyId: number, PhoneNormalized: string | null, ExceptId?: number) {
  if (!PhoneNormalized) return;
  const Conditions = [eq(Customers.CompanyId, CompanyId), eq(Customers.PhoneNormalized, PhoneNormalized)];
  if (ExceptId) Conditions.push(ne(Customers.Id, ExceptId));
  const [Taken] = await Db.select({ Id: Customers.Id }).from(Customers).where(and(...Conditions)).limit(1);
  if (Taken) throw new AppError(409, "PHONE_TAKEN", "Another customer already has this phone number");
}

export async function LookupByPhone(CompanyId: number, Phone: string) {
  const PhoneNormalized = NormalizeEgyptianPhone(Phone);
  if (!PhoneNormalized) throw new AppError(400, "VALIDATION_ERROR", "Phone is not a valid Egyptian mobile number");
  return Db.select()
    .from(Customers)
    .where(and(eq(Customers.CompanyId, CompanyId), eq(Customers.PhoneNormalized, PhoneNormalized)))
    .orderBy(Customers.Id);
}

export async function CreateCustomer(CompanyId: number, Input: { Name: string; Phone?: string; Email?: string }) {
  const PhoneNormalized = NormalizeEgyptianPhone(Input.Phone);
  await EnsurePhoneFree(CompanyId, PhoneNormalized);
  const [Customer] = await Db.insert(Customers).values({ CompanyId, ...Input, PhoneNormalized }).returning();
  return Customer;
}

export async function UpdateCustomer(CompanyId: number, Id: number, Input: { Name?: string; Phone?: string; Email?: string }) {
  const Changes: Partial<typeof Customers.$inferInsert> = { ...Input };
  if (Input.Phone !== undefined) {
    Changes.PhoneNormalized = NormalizeEgyptianPhone(Input.Phone);
    await EnsurePhoneFree(CompanyId, Changes.PhoneNormalized, Id);
  }
  const [Customer] = await Db.update(Customers)
    .set(Changes)
    .where(and(eq(Customers.Id, Id), eq(Customers.CompanyId, CompanyId)))
    .returning();
  if (!Customer) throw new AppError(404, "NOT_FOUND", "Customer not found");
  return Customer;
}
