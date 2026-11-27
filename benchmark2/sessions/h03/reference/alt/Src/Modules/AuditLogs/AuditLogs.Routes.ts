import { Hono } from "hono";
import { and, count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { Db } from "../../Database/Db";
import { AuditLogs, Users } from "../../Database/Schema";
import { RequireAuth, RequireRole, ScopedBranch, type AppEnv } from "../../Middleware/Auth";
import { Ok } from "../../Lib/Response";
import { IdQuery, ParseQuery } from "../../Lib/Validate";
import { PageMeta, PageQuery } from "../../Lib/Pagination";

export const AuditLogsRoutes = new Hono<AppEnv>();
AuditLogsRoutes.use("*", RequireAuth);

const AuditQuery = PageQuery.extend({ Action: z.string().trim().min(1).max(100).optional(), UserId: IdQuery.optional() });

AuditLogsRoutes.get("/", RequireRole("Owner", "Admin", "BranchManager"), async (C) => {
  const Auth = C.get("Auth");
  const Query = ParseQuery(C, AuditQuery);
  const Own = ScopedBranch(Auth);
  const Where = and(
    eq(AuditLogs.CompanyId, Auth.CompanyId),
    Own === null ? undefined : eq(AuditLogs.BranchId, Own),
    Query.Action === undefined ? undefined : eq(AuditLogs.Action, Query.Action),
    Query.UserId === undefined ? undefined : eq(AuditLogs.UserId, Query.UserId),
  );
  const Items = await Db.select({
    Id: AuditLogs.Id,
    Action: AuditLogs.Action,
    Entity: AuditLogs.Entity,
    EntityId: AuditLogs.EntityId,
    UserId: AuditLogs.UserId,
    UserName: Users.Name,
    BranchId: AuditLogs.BranchId,
    CreatedAt: AuditLogs.CreatedAt,
  })
    .from(AuditLogs)
    .leftJoin(Users, eq(Users.Id, AuditLogs.UserId))
    .where(Where)
    .orderBy(desc(AuditLogs.CreatedAt), desc(AuditLogs.Id))
    .limit(Query.PageSize)
    .offset((Query.Page - 1) * Query.PageSize);
  const [{ Total }] = await Db.select({ Total: count() }).from(AuditLogs).where(Where);
  return Ok(C, { Items, ...PageMeta(Query.Page, Query.PageSize, Total) });
});
