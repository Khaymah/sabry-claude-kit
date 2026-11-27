import { and, eq, gte, lt, sql } from "drizzle-orm";
import { Db } from "../../Database/Db";
import { Expenses } from "../../Database/Schema";
import { AppError } from "../../Lib/Response";
import { ToPiasters } from "../../Lib/Money";

export function MonthRange(Month: string) {
  const [Year, M] = Month.split("-").map(Number);
  const Next = M === 12 ? `${Year + 1}-01-01` : `${Year}-${String(M + 1).padStart(2, "0")}-01`;
  return { From: `${Month}-01`, To: Next };
}

export async function CreateExpense(CompanyId: number, Input: { Category: string; Amount: string; SpentOn: string; Note?: string }) {
  if (ToPiasters(Input.Amount) <= 0) throw new AppError(400, "VALIDATION_ERROR", "Amount must be positive");
  const [Expense] = await Db.insert(Expenses).values({ CompanyId, ...Input }).returning();
  return Expense;
}

export async function ListExpenses(CompanyId: number, Month: string) {
  const { From, To } = MonthRange(Month);
  return Db.select()
    .from(Expenses)
    .where(and(eq(Expenses.CompanyId, CompanyId), gte(Expenses.SpentOn, From), lt(Expenses.SpentOn, To)))
    .orderBy(Expenses.SpentOn, Expenses.Id);
}

export async function MonthlyTotals(CompanyId: number, Month: string) {
  const { From, To } = MonthRange(Month);
  return Db.select({ Category: Expenses.Category, Total: sql<string>`sum(${Expenses.Amount})::text` })
    .from(Expenses)
    .where(and(eq(Expenses.CompanyId, CompanyId), gte(Expenses.SpentOn, From), lt(Expenses.SpentOn, To)))
    .groupBy(Expenses.Category)
    .orderBy(Expenses.Category);
}

export async function DeleteExpense(CompanyId: number, Id: number) {
  const [Row] = await Db.delete(Expenses).where(and(eq(Expenses.Id, Id), eq(Expenses.CompanyId, CompanyId))).returning({ Id: Expenses.Id });
  if (!Row) throw new AppError(404, "NOT_FOUND", "Expense not found");
  return Row;
}
