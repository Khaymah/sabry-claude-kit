import { createMiddleware } from "hono/factory";
import { and, eq, gt } from "drizzle-orm";
import { Db } from "../Database/Db";
import { Sessions, Users } from "../Database/Schema";
import { AppError } from "../Lib/Response";
import { Now } from "../Lib/Clock";

export type AuthContext = { UserId: number; CompanyId: number; Role: string; SessionId: number; BranchId: number | null };
export type AppEnv = { Variables: { Auth: AuthContext } };

export const CompanyWideRoles = ["Owner", "Admin"];

export function IsBranchScoped(Auth: AuthContext) {
  return !CompanyWideRoles.includes(Auth.Role);
}

export function ScopedBranch(Auth: AuthContext): number | null {
  if (!IsBranchScoped(Auth)) return null;
  if (Auth.BranchId === null) throw new AppError(403, "FORBIDDEN", "No branch assigned");
  return Auth.BranchId;
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
    BranchId: Users.BranchId,
  })
    .from(Sessions)
    .innerJoin(Users, eq(Users.Id, Sessions.UserId))
    .where(and(eq(Sessions.Token, Token), gt(Sessions.ExpiresAt, Now()), eq(Users.IsActive, true)));
  if (!Row) throw new AppError(401, "UNAUTHORIZED", "Invalid or expired session");
  C.set("Auth", Row);
  await Next();
});

export function RequireRole(...Roles: string[]) {
  return createMiddleware<AppEnv>(async (C, Next) => {
    if (!Roles.includes(C.get("Auth").Role)) throw new AppError(403, "FORBIDDEN", "Not allowed");
    await Next();
  });
}
