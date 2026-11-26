import { createMiddleware } from "hono/factory";
import { and, eq, gt } from "drizzle-orm";
import { Db } from "../Database/Db";
import { Sessions, Users } from "../Database/Schema";
import { AppError } from "../Lib/Response";
import { Now } from "../Lib/Clock";

export type AuthContext = { UserId: number; CompanyId: number; Role: string; SessionId: number };
export type AppEnv = { Variables: { Auth: AuthContext } };

export const RequireAuth = createMiddleware<AppEnv>(async (C, Next) => {
  const Header = C.req.header("Authorization") ?? "";
  const Token = Header.startsWith("Bearer ") ? Header.slice(7).trim() : "";
  if (!Token) throw new AppError(401, "UNAUTHORIZED", "Missing token");
  const [Row] = await Db.select({
    SessionId: Sessions.Id,
    UserId: Users.Id,
    CompanyId: Users.CompanyId,
    Role: Users.Role,
  })
    .from(Sessions)
    .innerJoin(Users, eq(Users.Id, Sessions.UserId))
    .where(and(eq(Sessions.Token, Token), gt(Sessions.ExpiresAt, Now())));
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
