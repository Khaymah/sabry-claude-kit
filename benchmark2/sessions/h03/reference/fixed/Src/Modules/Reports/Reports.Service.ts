import { and, asc, eq, gte, lt, lte, ne, sql } from "drizzle-orm";
import { Db } from "../../Database/Db";
import { Branches, Expenses, Orders } from "../../Database/Schema";
import { AppError } from "../../Lib/Response";
import { FromPiasters, ToPiasters } from "../../Lib/Money";
import { ScopedBranch, type AuthContext } from "../../Middleware/Auth";

function NextDay(Day: string) {
  const D = new Date(`${Day}T00:00:00Z`);
  D.setUTCDate(D.getUTCDate() + 1);
  return D;
}

export async function BranchesReport(Auth: AuthContext, From: string, To: string, Requested?: number) {
  if (From > To) throw new AppError(400, "VALIDATION_ERROR", "From must not be after To");
  const Own = ScopedBranch(Auth);
  if (Own !== null && Requested !== undefined && Requested !== Own) throw new AppError(403, "FORBIDDEN", "You can only see your own branch");
  const BranchId = Own ?? Requested;
  const List = await Db.select({ Id: Branches.Id, Name: Branches.Name })
    .from(Branches)
    .where(and(eq(Branches.CompanyId, Auth.CompanyId), BranchId === undefined ? undefined : eq(Branches.Id, BranchId)))
    .orderBy(asc(Branches.Id));
  if (BranchId !== undefined && List.length === 0) throw new AppError(404, "NOT_FOUND", "Branch not found");
  const InBranch = (Column: typeof Orders.BranchId | typeof Expenses.BranchId) => (BranchId === undefined ? undefined : eq(Column, BranchId));
  const Sales = await Db.select({ BranchId: Orders.BranchId, Count: sql<number>`count(*)::int`, Total: sql<string>`coalesce(sum(${Orders.Total}), 0)::text` })
    .from(Orders)
    .where(
      and(
        eq(Orders.CompanyId, Auth.CompanyId),
        InBranch(Orders.BranchId),
        ne(Orders.Status, "Cancelled"),
        gte(Orders.CreatedAt, new Date(`${From}T00:00:00Z`)),
        lt(Orders.CreatedAt, NextDay(To)),
      ),
    )
    .groupBy(Orders.BranchId);
  const Spent = await Db.select({ BranchId: Expenses.BranchId, Total: sql<string>`coalesce(sum(${Expenses.Amount}), 0)::text` })
    .from(Expenses)
    .where(and(eq(Expenses.CompanyId, Auth.CompanyId), InBranch(Expenses.BranchId), gte(Expenses.SpentOn, From), lte(Expenses.SpentOn, To)))
    .groupBy(Expenses.BranchId);
  return List.map((Branch) => {
    const S = Sales.find((R) => R.BranchId === Branch.Id);
    const E = Spent.find((R) => R.BranchId === Branch.Id);
    const SalesP = S ? ToPiasters(S.Total) : 0;
    const ExpensesP = E ? ToPiasters(E.Total) : 0;
    return {
      BranchId: Branch.Id,
      Name: Branch.Name,
      OrdersCount: S?.Count ?? 0,
      Sales: FromPiasters(SalesP),
      Expenses: FromPiasters(ExpensesP),
      Net: FromPiasters(SalesP - ExpensesP),
    };
  });
}
