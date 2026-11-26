import { and, asc, eq, isNull } from "drizzle-orm";
import { Db, type Transaction } from "../../Database/Db";
import { BranchMemberships, Branches } from "../../Database/Schema";
import { AppError } from "../../Lib/Response";
import { RecordAudit } from "../../Lib/Audit";
import { Now } from "../../Lib/Clock";
import { EnsureMainBranch, ScopedBranch, type AuthContext } from "../../Middleware/Auth";

const PublicFields = { Id: Branches.Id, Name: Branches.Name, IsMain: Branches.IsMain, IsClosed: Branches.IsClosed };

export async function UsableBranch(Tx: Transaction, CompanyId: number, BranchId: number) {
  const [Branch] = await Tx.select()
    .from(Branches)
    .where(and(eq(Branches.Id, BranchId), eq(Branches.CompanyId, CompanyId)))
    .for("update");
  if (!Branch) throw new AppError(404, "NOT_FOUND", "Branch not found");
  if (Branch.IsClosed) throw new AppError(409, "BRANCH_CLOSED", "This branch is closed");
  return Branch.Id;
}

export async function BranchForWrite(Auth: AuthContext, Requested: number | undefined, Tx: Transaction) {
  const Own = ScopedBranch(Auth);
  return UsableBranch(Tx, Auth.CompanyId, Own ?? Requested ?? Auth.MainBranchId);
}

export async function CurrentMembership(Tx: Transaction, UserId: number) {
  const [Row] = await Tx.select()
    .from(BranchMemberships)
    .where(and(eq(BranchMemberships.UserId, UserId), isNull(BranchMemberships.EndedAt)))
    .for("update");
  return Row;
}

export async function Assign(Tx: Transaction, Auth: AuthContext, UserId: number, BranchId: number) {
  const Current = await CurrentMembership(Tx, UserId);
  if (Current) await Tx.update(BranchMemberships).set({ EndedAt: Now() }).where(eq(BranchMemberships.Id, Current.Id));
  await Tx.insert(BranchMemberships).values({ CompanyId: Auth.CompanyId, UserId, BranchId, StartedAt: Now() });
  if (Current) await RecordAudit({ CompanyId: Auth.CompanyId, UserId: Auth.UserId, Action: "User.Transfer", Entity: "User", EntityId: UserId, BranchId }, Tx);
}

export async function ListBranches(Auth: AuthContext) {
  return Db.select(PublicFields).from(Branches).where(eq(Branches.CompanyId, Auth.CompanyId)).orderBy(asc(Branches.Id));
}

export async function CreateBranch(Auth: AuthContext, Name: string) {
  await EnsureMainBranch(Auth.CompanyId);
  const [Branch] = await Db.insert(Branches).values({ CompanyId: Auth.CompanyId, Name }).returning(PublicFields);
  await RecordAudit({ CompanyId: Auth.CompanyId, UserId: Auth.UserId, Action: "Branch.Create", Entity: "Branch", EntityId: Branch.Id, BranchId: Branch.Id });
  return Branch;
}

export async function CloseBranch(Auth: AuthContext, BranchId: number, MoveStaffTo: number) {
  if (MoveStaffTo === BranchId) throw new AppError(400, "VALIDATION_ERROR", "MoveStaffTo must be another branch");
  return Db.transaction(async (Tx) => {
    const [Branch] = await Tx.select().from(Branches).where(and(eq(Branches.Id, BranchId), eq(Branches.CompanyId, Auth.CompanyId))).for("update");
    if (!Branch) throw new AppError(404, "NOT_FOUND", "Branch not found");
    if (Branch.IsMain || Branch.IsClosed) throw new AppError(409, "CANNOT_CLOSE", "This branch cannot be closed");
    await UsableBranch(Tx, Auth.CompanyId, MoveStaffTo);
    await Tx.update(Branches).set({ IsClosed: true }).where(eq(Branches.Id, BranchId));
    const Members = await Tx.select({ UserId: BranchMemberships.UserId })
      .from(BranchMemberships)
      .where(and(eq(BranchMemberships.BranchId, BranchId), isNull(BranchMemberships.EndedAt)))
      .for("update");
    for (const M of Members) await Assign(Tx, Auth, M.UserId, MoveStaffTo);
    await RecordAudit({ CompanyId: Auth.CompanyId, UserId: Auth.UserId, Action: "Branch.Close", Entity: "Branch", EntityId: BranchId, BranchId }, Tx);
    return { Id: BranchId, Name: Branch.Name, IsMain: false, IsClosed: true, MovedTo: MoveStaffTo, Moved: Members.map((M) => M.UserId) };
  });
}
