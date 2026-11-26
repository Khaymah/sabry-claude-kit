import { and, eq, gte, lt, sql } from "drizzle-orm";
import { Db } from "../../Database/Db";
import { Expenses } from "../../Database/Schema";
import { AppError } from "../../Lib/Response";
import { ToPiasters } from "../../Lib/Money";
import { RecordAudit } from "../../Lib/Audit";
import { ScopedBranch, type AuthContext } from "../../Middleware/Auth";
import { EffectiveBranch, InBranch } from "../../Lib/BranchScope";
import { BranchForWrite } from "../Branches/Branches.Service";

export function MonthRange(Month: string) {
  const [Year, M] = Month.split("-").map(Number);
  const Next = M === 12 ? `${Year + 1}-01-01` : `${Year}-${String(M + 1).padStart(2, "0")}-01`;
  return { From: `${Month}-01`, To: Next };
}

function ExpenseScope(Auth: AuthContext) {
  const Own = ScopedBranch(Auth);
  return and(eq(Expenses.CompanyId, Auth.CompanyId), Own === null ? undefined : InBranch(Expenses.BranchId, Own, Auth.MainBranchId));
}

type ExpenseInput = { Category: string; Amount: string; SpentOn: string; Note?: string; BranchId?: number };

export async function CreateExpense(Auth: AuthContext, Input: ExpenseInput) {
  if (ToPiasters(Input.Amount) <= 0) throw new AppError(400, "VALIDATION_ERROR", "Amount must be positive");
  return Db.transaction(async (Tx) => {
    const BranchId = await BranchForWrite(Auth, Input.BranchId, Tx);
    const [Expense] = await Tx.insert(Expenses)
      .values({ CompanyId: Auth.CompanyId, BranchId, Category: Input.Category, Amount: Input.Amount, SpentOn: Input.SpentOn, Note: Input.Note })
      .returning();
    await RecordAudit({ CompanyId: Auth.CompanyId, UserId: Auth.UserId, Action: "Expense.Create", Entity: "Expense", EntityId: Expense.Id, BranchId }, Tx);
    return Expense;
  });
}

export async function ListExpenses(Auth: AuthContext, Month: string) {
  const { From, To } = MonthRange(Month);
  const Rows = await Db.select()
    .from(Expenses)
    .where(and(ExpenseScope(Auth), gte(Expenses.SpentOn, From), lt(Expenses.SpentOn, To)))
    .orderBy(Expenses.SpentOn, Expenses.Id);
  return Rows.map((R) => ({ ...R, BranchId: EffectiveBranch(Auth, R.BranchId) }));
}

export async function MonthlyTotals(Auth: AuthContext, Month: string) {
  const { From, To } = MonthRange(Month);
  return Db.select({ Category: Expenses.Category, Total: sql<string>`sum(${Expenses.Amount})::text` })
    .from(Expenses)
    .where(and(ExpenseScope(Auth), gte(Expenses.SpentOn, From), lt(Expenses.SpentOn, To)))
    .groupBy(Expenses.Category)
    .orderBy(Expenses.Category);
}

export async function DeleteExpense(Auth: AuthContext, Id: number) {
  return Db.transaction(async (Tx) => {
    const [Row] = await Tx.delete(Expenses)
      .where(and(ExpenseScope(Auth), eq(Expenses.Id, Id)))
      .returning({ Id: Expenses.Id, BranchId: Expenses.BranchId });
    if (!Row) throw new AppError(404, "NOT_FOUND", "Expense not found");
    await RecordAudit({ CompanyId: Auth.CompanyId, UserId: Auth.UserId, Action: "Expense.Delete", Entity: "Expense", EntityId: Row.Id, BranchId: EffectiveBranch(Auth, Row.BranchId) }, Tx);
    return { Id: Row.Id };
  });
}
