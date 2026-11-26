import { createMiddleware } from "hono/factory";
import { and, eq, gt, gte, isNull } from "drizzle-orm";
import { Db } from "../Database/Db";
import { BranchMemberships, Branches, Sessions, Users } from "../Database/Schema";
import { AppError } from "../Lib/Response";
import { Now } from "../Lib/Clock";

export type AuthContext = {
  UserId: number;
  CompanyId: number;
  Role: string;
  SessionId: number;
  BranchId: number | null;
  MainBranchId: number;
};
export type AppEnv = { Variables: { Auth: AuthContext } };

const CompanyWideRoles = new Set(["Owner", "Admin"]);

export function IsBranchScoped(Auth: Pick<AuthContext, "Role">) {
  return !CompanyWideRoles.has(Auth.Role);
}

export function ScopedBranch(Auth: AuthContext): number | null {
  if (!IsBranchScoped(Auth)) return null;
  if (Auth.BranchId === null) throw new AppError(403, "FORBIDDEN", "No branch assigned");
  return Auth.BranchId;
}

export async function EnsureMainBranch(CompanyId: number): Promise<number> {
  const [Main] = await Db.select({ Id: Branches.Id }).from(Branches).where(and(eq(Branches.CompanyId, CompanyId), eq(Branches.IsMain, true)));
  if (Main) return Main.Id;
  const [Created] = await Db.insert(Branches)
    .values({ CompanyId, Name: "Main Branch", IsMain: true })
    .onConflictDoNothing()
    .returning({ Id: Branches.Id });
  return Created ? Created.Id : EnsureMainBranch(CompanyId);
}

export const RequireAuth = createMiddleware<AppEnv>(async (C, Next) => {
  const Header = C.req.header("Authorization") ?? "";
  const Token = Header.startsWith("Bearer ") ? Header.slice(7).trim() : "";
  if (!Token) throw new AppError(401, "UNAUTHORIZED", "Missing token");
  const [Row] = await Db.select({
    SessionId: Sessions.Id,
    UserId: Users.Id,
    CompanyId: Users.CompanyId,
    Role: Users.Role,
    BranchId: BranchMemberships.BranchId,
  })
    .from(Sessions)
    .innerJoin(Users, eq(Users.Id, Sessions.UserId))
    .leftJoin(BranchMemberships, and(eq(BranchMemberships.UserId, Users.Id), isNull(BranchMemberships.EndedAt)))
    .where(and(eq(Sessions.Token, Token), gt(Sessions.ExpiresAt, Now()), eq(Users.IsActive, true), gte(Sessions.Id, Users.SessionFloor)));
  if (!Row) throw new AppError(401, "UNAUTHORIZED", "Invalid or expired session");
  C.set("Auth", { ...Row, MainBranchId: await EnsureMainBranch(Row.CompanyId) });
  await Next();
});

export function RequireRole(...Roles: string[]) {
  return createMiddleware<AppEnv>(async (C, Next) => {
    if (!Roles.includes(C.get("Auth").Role)) throw new AppError(403, "FORBIDDEN", "Not allowed");
    await Next();
  });
}
