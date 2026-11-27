import { and, asc, eq, gte, lt, lte, ne } from "drizzle-orm";
import { Db } from "../../Database/Db";
import { Branches, Expenses, Orders } from "../../Database/Schema";
import { AppError } from "../../Lib/Response";
import { FromPiasters, ToPiasters } from "../../Lib/Money";
import { EffectiveBranch } from "../../Lib/BranchScope";
import { ScopedBranch, type AuthContext } from "../../Middleware/Auth";

const DayStart = (Day: string) => new Date(`${Day}T00:00:00Z`);

export async function BranchesReport(Auth: AuthContext, From: string, To: string, Requested?: number) {
  if (From > To) throw new AppError(400, "VALIDATION_ERROR", "From must not be after To");
  const Wanted = ScopedBranch(Auth) ?? Requested;
  const AllBranches = await Db.select({ Id: Branches.Id, Name: Branches.Name }).from(Branches).where(eq(Branches.CompanyId, Auth.CompanyId)).orderBy(asc(Branches.Id));
  const Picked = AllBranches.filter((B) => Wanted === undefined || B.Id === Wanted);
  const End = DayStart(To);
  End.setUTCDate(End.getUTCDate() + 1);
  const OrderRows = await Db.select({ BranchId: Orders.BranchId, Total: Orders.Total })
    .from(Orders)
    .where(and(eq(Orders.CompanyId, Auth.CompanyId), ne(Orders.Status, "Cancelled"), gte(Orders.CreatedAt, DayStart(From)), lt(Orders.CreatedAt, End)));
  const ExpenseRows = await Db.select({ BranchId: Expenses.BranchId, Amount: Expenses.Amount })
    .from(Expenses)
    .where(and(eq(Expenses.CompanyId, Auth.CompanyId), gte(Expenses.SpentOn, From), lte(Expenses.SpentOn, To)));
  const Totals = new Map(Picked.map((B) => [B.Id, { Count: 0, Sales: 0, Spent: 0 }]));
  for (const O of OrderRows) {
    const T = Totals.get(EffectiveBranch(Auth, O.BranchId));
    if (T) {
      T.Count++;
      T.Sales += ToPiasters(O.Total);
    }
  }
  for (const E of ExpenseRows) {
    const T = Totals.get(EffectiveBranch(Auth, E.BranchId));
    if (T) T.Spent += ToPiasters(E.Amount);
  }
  return Picked.map((B) => {
    const T = Totals.get(B.Id)!;
    return { BranchId: B.Id, Name: B.Name, OrdersCount: T.Count, Sales: FromPiasters(T.Sales), Expenses: FromPiasters(T.Spent), Net: FromPiasters(T.Sales - T.Spent) };
  });
}
