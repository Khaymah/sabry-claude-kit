import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { Db, type Transaction } from "../../Database/Db";
import { BranchMemberships, Sessions, Users } from "../../Database/Schema";
import { AppError } from "../../Lib/Response";
import { RecordAudit } from "../../Lib/Audit";
import { ScopedBranch, type AuthContext } from "../../Middleware/Auth";
import { HashPassword } from "../Auth/Auth.Service";
import { Assign, BranchForWrite, CurrentMembership, UsableBranch } from "../Branches/Branches.Service";

const Fields = {
  Id: Users.Id,
  CompanyId: Users.CompanyId,
  Email: Users.Email,
  Name: Users.Name,
  Role: Users.Role,
  IsActive: Users.IsActive,
  BranchId: BranchMemberships.BranchId,
};

const Current = and(eq(BranchMemberships.UserId, Users.Id), isNull(BranchMemberships.EndedAt));

const RolesByCreator: Record<string, string[]> = {
  Owner: ["Admin", "Staff", "BranchManager", "Cashier"],
  Admin: ["Admin", "Staff", "BranchManager", "Cashier"],
  BranchManager: ["Staff", "Cashier"],
};

async function ReadUser(Executor: Transaction | typeof Db, UserId: number) {
  const [User] = await Executor.select(Fields).from(Users).leftJoin(BranchMemberships, Current).where(eq(Users.Id, UserId));
  return User;
}

type CreateInput = { Email: string; Name: string; Password: string; Role: string; BranchId?: number };

export async function CreateUser(Auth: AuthContext, Input: CreateInput) {
  if (!(RolesByCreator[Auth.Role] ?? []).includes(Input.Role)) throw new AppError(403, "FORBIDDEN", "You cannot create this role");
  const PasswordHash = await HashPassword(Input.Password);
  const Id = await Db.transaction(async (Tx) => {
    const [Taken] = await Tx.select({ Id: Users.Id }).from(Users).where(eq(Users.Email, Input.Email));
    if (Taken) throw new AppError(409, "EMAIL_TAKEN", "Email already registered");
    const BranchId = Input.Role === "Admin" ? null : await BranchForWrite(Auth, Input.BranchId, Tx);
    const [User] = await Tx.insert(Users)
      .values({ CompanyId: Auth.CompanyId, Email: Input.Email, Name: Input.Name, Role: Input.Role, PasswordHash })
      .returning({ Id: Users.Id });
    if (BranchId !== null) await Assign(Tx, Auth, User.Id, BranchId);
    await RecordAudit({ CompanyId: Auth.CompanyId, UserId: Auth.UserId, Action: "User.Create", Entity: "User", EntityId: User.Id, BranchId }, Tx);
    return User.Id;
  });
  return ReadUser(Db, Id);
}

export async function ListUsers(Auth: AuthContext) {
  const Own = ScopedBranch(Auth);
  return Db.select(Fields)
    .from(Users)
    .leftJoin(BranchMemberships, Current)
    .where(and(eq(Users.CompanyId, Auth.CompanyId), Own === null ? undefined : eq(BranchMemberships.BranchId, Own)))
    .orderBy(Users.Id);
}

async function Reachable(Tx: Transaction, Auth: AuthContext, UserId: number) {
  const [User] = await Tx.select().from(Users).where(and(eq(Users.Id, UserId), eq(Users.CompanyId, Auth.CompanyId))).for("update");
  if (!User) throw new AppError(404, "NOT_FOUND", "User not found");
  const Membership = await CurrentMembership(Tx, User.Id);
  const Own = ScopedBranch(Auth);
  if (Own !== null && (Membership?.BranchId !== Own || !RolesByCreator.BranchManager.includes(User.Role)))
    throw new AppError(403, "FORBIDDEN", "This user is outside your branch");
  return { User, BranchId: Membership?.BranchId ?? null };
}

export async function SetActive(Auth: AuthContext, UserId: number, IsActive: boolean) {
  await Db.transaction(async (Tx) => {
    const Target = await Reachable(Tx, Auth, UserId);
    await Tx.update(Users)
      .set(IsActive ? { IsActive } : { IsActive, SessionFloor: sql`(SELECT coalesce(max(${Sessions.Id}), 0) + 1 FROM ${Sessions})` })
      .where(eq(Users.Id, UserId));
    await RecordAudit(
      { CompanyId: Auth.CompanyId, UserId: Auth.UserId, Action: IsActive ? "User.Activate" : "User.Deactivate", Entity: "User", EntityId: UserId, BranchId: Target.BranchId },
      Tx,
    );
  });
  return ReadUser(Db, UserId);
}

export async function TransferUser(Auth: AuthContext, UserId: number, BranchId: number) {
  await Db.transaction(async (Tx) => {
    const Target = await Reachable(Tx, Auth, UserId);
    if (Target.BranchId === null) throw new AppError(400, "NOT_BRANCH_USER", "Only branch staff can be transferred");
    await UsableBranch(Tx, Auth.CompanyId, BranchId);
    if (Target.BranchId !== BranchId) await Assign(Tx, Auth, UserId, BranchId);
  });
  return ReadUser(Db, UserId);
}

export async function ListTransfers(Auth: AuthContext, UserId: number) {
  const [User] = await Db.select({ Id: Users.Id }).from(Users).where(and(eq(Users.Id, UserId), eq(Users.CompanyId, Auth.CompanyId)));
  if (!User) throw new AppError(404, "NOT_FOUND", "User not found");
  const Spans = await Db.select().from(BranchMemberships).where(eq(BranchMemberships.UserId, UserId)).orderBy(asc(BranchMemberships.Id));
  return Spans.slice(1).map((Span, I) => ({ FromBranchId: Spans[I].BranchId, ToBranchId: Span.BranchId, CreatedAt: Span.StartedAt }));
}

export async function ChangePassword(UserId: number, CurrentPassword: string, NewPassword: string) {
  const [User] = await Db.select().from(Users).where(eq(Users.Id, UserId));
  if (!User || !(await Bun.password.verify(CurrentPassword, User.PasswordHash)))
    throw new AppError(400, "INVALID_PASSWORD", "Current password is wrong");
  await Db.update(Users).set({ PasswordHash: await HashPassword(NewPassword) }).where(eq(Users.Id, UserId));
}
