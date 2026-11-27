import { and, asc, eq } from "drizzle-orm";
import { Db, type Transaction } from "../../Database/Db";
import { BranchTransfers, Sessions, Users } from "../../Database/Schema";
import { AppError } from "../../Lib/Response";
import { RecordAudit } from "../../Lib/Audit";
import { ScopedBranch, type AuthContext } from "../../Middleware/Auth";
import { HashPassword } from "../Auth/Auth.Service";
import { BranchForWrite, OpenBranch, RecordTransfer } from "../Branches/Branches.Service";

const PublicFields = {
  Id: Users.Id,
  CompanyId: Users.CompanyId,
  Email: Users.Email,
  Name: Users.Name,
  Role: Users.Role,
  IsActive: Users.IsActive,
  BranchId: Users.BranchId,
};

const ManagerCreatableRoles = ["Staff", "Cashier"];

type CreateInput = { Email: string; Name: string; Password: string; Role: string; BranchId?: number };

export async function CreateUser(Auth: AuthContext, Input: CreateInput) {
  if (Auth.Role === "BranchManager" && !ManagerCreatableRoles.includes(Input.Role))
    throw new AppError(403, "FORBIDDEN", "Branch managers can only add staff and cashiers");
  const PasswordHash = await HashPassword(Input.Password);
  return Db.transaction(async (Tx) => {
    const [Existing] = await Tx.select({ Id: Users.Id }).from(Users).where(eq(Users.Email, Input.Email));
    if (Existing) throw new AppError(409, "EMAIL_TAKEN", "Email already registered");
    const BranchId = Input.Role === "Admin" ? null : await BranchForWrite(Auth, Input.BranchId, Tx);
    const [User] = await Tx.insert(Users)
      .values({ CompanyId: Auth.CompanyId, Email: Input.Email, Name: Input.Name, Role: Input.Role, BranchId, PasswordHash })
      .returning(PublicFields);
    await RecordAudit({ CompanyId: Auth.CompanyId, UserId: Auth.UserId, Action: "User.Create", Entity: "User", EntityId: User.Id, BranchId }, Tx);
    return User;
  });
}

export async function ListUsers(Auth: AuthContext) {
  const Own = ScopedBranch(Auth);
  const Where = Own === null ? eq(Users.CompanyId, Auth.CompanyId) : and(eq(Users.CompanyId, Auth.CompanyId), eq(Users.BranchId, Own));
  return Db.select(PublicFields).from(Users).where(Where).orderBy(Users.Id);
}

async function ManagedUser(Auth: AuthContext, UserId: number, Executor: Transaction) {
  const [User] = await Executor.select()
    .from(Users)
    .where(and(eq(Users.Id, UserId), eq(Users.CompanyId, Auth.CompanyId)))
    .for("update");
  if (!User) throw new AppError(404, "NOT_FOUND", "User not found");
  const Own = ScopedBranch(Auth);
  if (Own !== null && (User.BranchId !== Own || !ManagerCreatableRoles.includes(User.Role)))
    throw new AppError(404, "NOT_FOUND", "User not found");
  return User;
}

export async function SetActive(Auth: AuthContext, UserId: number, IsActive: boolean) {
  return Db.transaction(async (Tx) => {
    const Target = await ManagedUser(Auth, UserId, Tx);
    const [User] = await Tx.update(Users).set({ IsActive }).where(eq(Users.Id, Target.Id)).returning(PublicFields);
    if (!IsActive) await Tx.delete(Sessions).where(eq(Sessions.UserId, Target.Id));
    await RecordAudit(
      { CompanyId: Auth.CompanyId, UserId: Auth.UserId, Action: IsActive ? "User.Activate" : "User.Deactivate", Entity: "User", EntityId: Target.Id, BranchId: Target.BranchId },
      Tx,
    );
    return User;
  });
}

export async function TransferUser(Auth: AuthContext, UserId: number, BranchId: number) {
  return Db.transaction(async (Tx) => {
    const Target = await ManagedUser(Auth, UserId, Tx);
    if (Target.BranchId === null) throw new AppError(409, "NOT_BRANCH_USER", "This user does not belong to a branch");
    await OpenBranch(Auth.CompanyId, BranchId, Tx);
    if (Target.BranchId === BranchId) throw new AppError(409, "SAME_BRANCH", "The user is already in this branch");
    await RecordTransfer(Tx, Auth, Target, BranchId);
    const [User] = await Tx.select(PublicFields).from(Users).where(eq(Users.Id, Target.Id));
    return User;
  });
}

export async function ListTransfers(Auth: AuthContext, UserId: number) {
  const [User] = await Db.select({ Id: Users.Id }).from(Users).where(and(eq(Users.Id, UserId), eq(Users.CompanyId, Auth.CompanyId)));
  if (!User) throw new AppError(404, "NOT_FOUND", "User not found");
  return Db.select({
    Id: BranchTransfers.Id,
    FromBranchId: BranchTransfers.FromBranchId,
    ToBranchId: BranchTransfers.ToBranchId,
    ByUserId: BranchTransfers.ByUserId,
    CreatedAt: BranchTransfers.CreatedAt,
  })
    .from(BranchTransfers)
    .where(eq(BranchTransfers.UserId, UserId))
    .orderBy(asc(BranchTransfers.Id));
}

export async function ChangePassword(UserId: number, CurrentPassword: string, NewPassword: string) {
  const [User] = await Db.select().from(Users).where(eq(Users.Id, UserId));
  if (!User || !(await Bun.password.verify(CurrentPassword, User.PasswordHash)))
    throw new AppError(400, "INVALID_PASSWORD", "Current password is wrong");
  await Db.update(Users).set({ PasswordHash: await HashPassword(NewPassword) }).where(eq(Users.Id, UserId));
}
