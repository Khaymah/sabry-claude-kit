import { and, count, desc, eq, sql } from "drizzle-orm";
import { Db } from "../../Database/Db";
import { Suppliers } from "../../Database/Schema";
import { AppError } from "../../Lib/Response";
import { PageMeta } from "../../Lib/Pagination";
import { RecordAudit } from "../../Lib/Audit";

export async function ListSuppliers(CompanyId: number, Page: number, PageSize: number, Q?: string) {
  const Pattern = Q ? `%${Q.replace(/[\\%_]/g, (Ch) => `\\${Ch}`)}%` : null;
  const Where = Pattern ? and(eq(Suppliers.CompanyId, CompanyId), sql`${Suppliers.Name} ILIKE ${Pattern} ESCAPE '\\'`) : eq(Suppliers.CompanyId, CompanyId);
  const Items = await Db.select().from(Suppliers).where(Where).orderBy(desc(Suppliers.Id)).limit(PageSize).offset((Page - 1) * PageSize);
  const [{ Total }] = await Db.select({ Total: count() }).from(Suppliers).where(Where);
  return { Items, ...PageMeta(Page, PageSize, Total) };
}

export async function GetSupplier(CompanyId: number, Id: number) {
  const [Supplier] = await Db.select().from(Suppliers).where(and(eq(Suppliers.Id, Id), eq(Suppliers.CompanyId, CompanyId)));
  if (!Supplier) throw new AppError(404, "NOT_FOUND", "Supplier not found");
  return Supplier;
}

export async function CreateSupplier(CompanyId: number, UserId: number, Input: { Name: string; Phone?: string }) {
  const [Supplier] = await Db.insert(Suppliers).values({ CompanyId, ...Input }).returning();
  await RecordAudit({ CompanyId, UserId, Action: "Create", Entity: "Supplier", EntityId: Supplier.Id });
  return Supplier;
}

export async function UpdateSupplier(CompanyId: number, UserId: number, Id: number, Input: { Name?: string; Phone?: string }) {
  const [Supplier] = await Db.update(Suppliers).set(Input).where(and(eq(Suppliers.Id, Id), eq(Suppliers.CompanyId, CompanyId))).returning();
  if (!Supplier) throw new AppError(404, "NOT_FOUND", "Supplier not found");
  await RecordAudit({ CompanyId, UserId, Action: "Update", Entity: "Supplier", EntityId: Id });
  return Supplier;
}
