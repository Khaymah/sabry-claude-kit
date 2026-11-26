import { createMiddleware } from "hono/factory";
import { createHash } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { Db } from "../Database/Db";
import { ApiKeys, Sessions, Users } from "../Database/Schema";
import { AppError } from "../Lib/Response";
import { Now } from "../Lib/Clock";

export type AuthContext = { UserId: number; CompanyId: number; Role: string; SessionId: number };
export type AppEnv = { Variables: { Auth: AuthContext } };

const IntegrationRoutes: [string, RegExp][] = [
  ["GET", /^\/Products\/?$/],
  ["GET", /^\/Products\/\d+$/],
  ["GET", /^\/Orders\/?$/],
  ["GET", /^\/Orders\/\d+$/],
  ["POST", /^\/Orders\/?$/],
];

export function HashApiKey(Key: string) {
  return createHash("sha256").update(Key).digest("hex");
}

export const RequireAuth = createMiddleware<AppEnv>(async (C, Next) => {
  const ApiKey = C.req.header("X-Api-Key");
  if (ApiKey !== undefined) {
    const [Key] = await Db.select({ Id: ApiKeys.Id, CompanyId: ApiKeys.CompanyId })
      .from(ApiKeys)
      .where(and(eq(ApiKeys.KeyHash, HashApiKey(ApiKey.trim())), isNull(ApiKeys.RevokedAt)));
    if (!Key) throw new AppError(401, "UNAUTHORIZED", "Invalid API key");
    if (!IntegrationRoutes.some(([Method, Path]) => Method === C.req.method && Path.test(C.req.path)))
      throw new AppError(403, "FORBIDDEN", "API keys cannot use this endpoint");
    C.set("Auth", { UserId: 0, CompanyId: Key.CompanyId, Role: "Integration", SessionId: 0 });
    return Next();
  }
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
