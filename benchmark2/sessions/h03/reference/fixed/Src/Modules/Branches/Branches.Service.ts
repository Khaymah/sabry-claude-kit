import { and, asc, eq } from "drizzle-orm";
import { Db, type Transaction } from "../../Database/Db";
import { Branches, BranchTransfers, Users } from "../../Database/Schema";
import { AppError } from "../../Lib/Response";
import { RecordAudit } from "../../Lib/Audit";
import { ScopedBranch, type AuthContext } from "../../Middleware/Auth";

type Executor = Transaction | typeof Db;

const PublicFields = { Id: Branches.Id, Name: Branches.Name, IsMain: Branches.IsMain, IsClosed: Branches.IsClosed };

export async function MainBranchId(CompanyId: number, Executor: Executor = Db) {
  const [Main] = await Executor.select({ Id: Branches.Id })
    .from(Branches)
    .where(and(eq(Branches.CompanyId, CompanyId), eq(Branches.IsMain, true)));
  if (Main) return Main.Id;
  const [Created] = await Executor.insert(Branches).values({ CompanyId, Name: "Main", IsMain: true }).returning({ Id: Branches.Id });
  return Created.Id;
}

export async function LockBranch(CompanyId: number, BranchId: number, Executor: Executor) {
  const [Branch] = await Executor.select()
    .from(Branches)
    .where(and(eq(Branches.Id, BranchId), eq(Branches.CompanyId, CompanyId)))
    .for("update");
  if (!Branch) throw new AppError(404, "NOT_FOUND", "Branch not found");
  return Branch;
}

export async function OpenBranch(CompanyId: number, BranchId: number, Executor: Executor) {
  const Branch = await LockBranch(CompanyId, BranchId, Executor);
  if (Branch.IsClosed) throw new AppError(409, "BRANCH_CLOSED", "This branch is closed");
  return Branch;
}

export async function BranchForWrite(Auth: AuthContext, Requested: number | undefined, Executor: Executor) {
  const Own = ScopedBranch(Auth);
  if (Own !== null) {
    if (Requested !== undefined && Requested !== Own) throw new AppError(403, "FORBIDDEN", "You can only work on your own branch");
    return (await OpenBranch(Auth.CompanyId, Own, Executor)).Id;
  }
  const Id = Requested ?? (await MainBranchId(Auth.CompanyId, Executor));
  return (await OpenBranch(Auth.CompanyId, Id, Executor)).Id;
}

export async function RecordTransfer(
  Tx: Transaction,
  Auth: AuthContext,
  User: { Id: number; BranchId: number | null },
  ToBranchId: number,
) {
  await Tx.update(Users).set({ BranchId: ToBranchId }).where(eq(Users.Id, User.Id));
  await Tx.insert(BranchTransfers).values({
    CompanyId: Auth.CompanyId,
    UserId: User.Id,
    FromBranchId: User.BranchId,
    ToBranchId,
    ByUserId: Auth.UserId,
  });
  await RecordAudit({ CompanyId: Auth.CompanyId, UserId: Auth.UserId, Action: "User.Transfer", Entity: "User", EntityId: User.Id, BranchId: ToBranchId }, Tx);
}

export async function ListBranches(CompanyId: number) {
  await MainBranchId(CompanyId);
  return Db.select(PublicFields).from(Branches).where(eq(Branches.CompanyId, CompanyId)).orderBy(asc(Branches.Id));
}

export async function CreateBranch(Auth: AuthContext, Name: string) {
  return Db.transaction(async (Tx) => {
    await MainBranchId(Auth.CompanyId, Tx);
    const [Branch] = await Tx.insert(Branches).values({ CompanyId: Auth.CompanyId, Name }).returning(PublicFields);
    await RecordAudit({ CompanyId: Auth.CompanyId, UserId: Auth.UserId, Action: "Branch.Create", Entity: "Branch", EntityId: Branch.Id, BranchId: Branch.Id }, Tx);
    return Branch;
  });
}

export async function CloseBranch(Auth: AuthContext, BranchId: number, MoveStaffTo: number) {
  return Db.transaction(async (Tx) => {
    const Branch = await LockBranch(Auth.CompanyId, BranchId, Tx);
    if (Branch.IsMain) throw new AppError(409, "MAIN_BRANCH", "The main branch cannot be closed");
    if (Branch.IsClosed) throw new AppError(409, "BRANCH_CLOSED", "This branch is already closed");
    if (MoveStaffTo === BranchId) throw new AppError(400, "VALIDATION_ERROR", "MoveStaffTo must be another branch");
    await OpenBranch(Auth.CompanyId, MoveStaffTo, Tx);
    const Staff = await Tx.select({ Id: Users.Id, BranchId: Users.BranchId })
      .from(Users)
      .where(and(eq(Users.CompanyId, Auth.CompanyId), eq(Users.BranchId, BranchId)))
      .for("update");
    for (const User of Staff) await RecordTransfer(Tx, Auth, User, MoveStaffTo);
    const [Closed] = await Tx.update(Branches).set({ IsClosed: true }).where(eq(Branches.Id, BranchId)).returning(PublicFields);
    await RecordAudit({ CompanyId: Auth.CompanyId, UserId: Auth.UserId, Action: "Branch.Close", Entity: "Branch", EntityId: BranchId, BranchId }, Tx);
    return { ...Closed, MovedStaff: Staff.length };
  });
}
