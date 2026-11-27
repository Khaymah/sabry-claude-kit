import { and, count, desc, eq } from "drizzle-orm";
import { Db } from "../../Database/Db";
import { Customers } from "../../Database/Schema";
import { AppError } from "../../Lib/Response";
import { PageMeta } from "../../Lib/Pagination";
import { CreateCustomerBody } from "./Customers.Schema";

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

export async function ExportCsv(CompanyId: number) {
  const Rows = await Db.select().from(Customers).where(eq(Customers.CompanyId, CompanyId)).orderBy(Customers.Id);
  const Lines = ["Name,Phone,Email", ...Rows.map((R) => [R.Name, R.Phone ?? "", R.Email ?? ""].join(","))];
  return Lines.join("\n");
}

export async function ImportCsv(CompanyId: number, Text: string) {
  const Lines = Text.split("\n").filter((L) => L.trim() !== "");
  const Header = (Lines[0] ?? "").split(",").map((H) => H.trim());
  const NameAt = Header.indexOf("Name");
  const PhoneAt = Header.indexOf("Phone");
  const EmailAt = Header.indexOf("Email");
  let Created = 0;
  const Errors: { Row: number; Message: string }[] = [];
  for (let I = 1; I < Lines.length; I++) {
    const Cols = Lines[I].split(",");
    const Parsed = CreateCustomerBody.safeParse({
      Name: Cols[NameAt] ?? "",
      Phone: PhoneAt >= 0 && Cols[PhoneAt] ? Cols[PhoneAt] : undefined,
      Email: EmailAt >= 0 && Cols[EmailAt]?.trim() ? Cols[EmailAt] : undefined,
    });
    if (!Parsed.success) {
      Errors.push({ Row: I + 1, Message: Parsed.error.issues[0]?.message ?? "Invalid row" });
      continue;
    }
    await Db.insert(Customers).values({ CompanyId, ...Parsed.data });
    Created++;
  }
  return { Created, Errors };
}
