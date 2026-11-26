# Multi-tenancy

- **Situation:** a SaaS where several companies, stores, schools or clinics share one app; "each client sees only their data"; workspaces, organisations, teams.
- **Skip when:** one deployment per client with its own database (then there is one tenant per database and nothing to isolate inside it).
- **Decision:** shared database, shared schema, a `TenantId` on every tenant-owned table. The tenant comes from the authenticated session, never from the request body or URL alone; every query is scoped by one helper; Postgres Row-Level Security is the second line at Standard.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Early SaaS, a few tenants: `TenantId` + scoped helper + tests |
| Standard | Real paying tenants: + RLS, tenant-aware caches, keys and jobs |
| Advanced | Enterprise tenants, compliance: per-tenant limits, isolation options, data residency |

## Rules

### Minimum — always, never cut

- Every tenant-owned table has `TenantId uuid NOT NULL REFERENCES "Tenants"`, first column of its composite indexes and of its unique keys (`UNIQUE ("TenantId", "Slug")`).
- The current tenant is resolved once per request from the session (user's membership), set in context, and never accepted from the body.
- All tenant data is read and written through `ForTenant(Table)` conditions; inserts set `TenantId` from context.
- A user who belongs to several tenants picks one; switching is an explicit request that checks membership.
- Cross-tenant ids in a request (a `ProjectId` from another tenant) return `404`.

### Standard — adds

- RLS on every tenant table: `ENABLE` + `FORCE ROW LEVEL SECURITY`, policy `USING ("TenantId" = current_setting('app.tenant_id')::uuid)`; the app connects with a role that is not the table owner; each request's transaction runs `SELECT set_config('app.tenant_id', $1, true)`.
- Every cache key, file path, queue job and search index entry includes the tenant id.
- Background jobs carry `TenantId` in their payload and set the same context before touching data.
- Tests: for every endpoint, a request with tenant A's session for tenant B's resource returns 404.
- Per-tenant settings override global `SystemSettings` through a `TenantSettings` table.

### Advanced — adds

- Per-tenant rate limits and quotas so one tenant can't starve others.
- Tenant export and deletion (all rows by `TenantId`, files by prefix) as tested jobs.
- Isolation tiers for enterprise: dedicated database or schema for tenants that pay for it, same code, connection chosen by tenant.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Super-admin support access | A separate admin path with its own permission, audit-logged, that sets the tenant context explicitly; never "RLS off" |
| Shared reference data (countries, plans) | Tables without `TenantId`, read-only to tenants, no RLS |
| Unique email across the platform vs per tenant | Users global (unique email), memberships per tenant `(TenantId, UserId)` |
| Report across all tenants (owner's dashboard) | Runs with a separate reporting role that bypasses RLS, read-only, never from tenant endpoints |
| Connection pooling with RLS | `set_config(…, true)` is transaction-local, so pooled connections never carry another request's tenant |
| 100×: 5,000 tenants | Same schema; indexes start with `TenantId`; the biggest tenants watched for noisy-neighbour load |
| Twice / parallel: two requests from different tenants on one pooled connection | Each sets its own tenant inside its own transaction; nothing persists on the connection |

## Example — Standard, Drizzle

```ts
export const ForTenant = (T: { TenantId: AnyPgColumn }) => eq(T.TenantId, CurrentTenantId())

export async function InTenant<R>(TenantId: string, Work: (Tx: TTx) => Promise<R>) {
  return db.transaction(async (Tx) => {
    await Tx.execute(sql`select set_config('app.tenant_id', ${TenantId}, true)`)
    return TenantContext.run({ TenantId }, () => Work(Tx))
  })
}

export const ListProjects = (Limit: number) =>
  InTenant(CurrentTenantId(), (Tx) =>
    Tx.select({ Id: Projects.Id, Name: Projects.Name }).from(Projects)
      .where(and(ForTenant(Projects), NotDeleted(Projects)))
      .orderBy(desc(Projects.CreatedAt)).limit(Math.min(Limit, 100)))
```

```sql
ALTER TABLE "Projects" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Projects" FORCE ROW LEVEL SECURITY;
CREATE POLICY "TenantIsolation" ON "Projects"
  USING ("TenantId" = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK ("TenantId" = current_setting('app.tenant_id', true)::uuid);
```

The explicit `ForTenant` condition stays even with RLS: it uses the index and keeps behaviour correct if a policy is ever missing.

## Verify

- [ ] `[M]` Every tenant table has `TenantId NOT NULL` and indexes starting with it.
- [ ] `[M]` No handler reads a tenant id from the body (`grep "TenantId" *.Schema.ts`).
- [ ] `[M]` Cross-tenant test: tenant A's session on tenant B's ids → 404 for every endpoint.
- [ ] `[S]` With the explicit filter removed from one query in a test, RLS still returns nothing from another tenant.
- [ ] `[S]` Cache keys and file paths include the tenant id.
- [ ] `[A]` Tenant export produces every row and file of one tenant and nothing else.

## Pitfalls

- **Tenant from the URL or body** → anyone can read any tenant → session-derived tenant.
- **App connects as the table owner** → RLS silently bypassed → separate role + `FORCE`.
- **`set_config` without `is_local`** → tenant leaks to the next request on that pooled connection → transaction-local.

## Related

`backend/auth/rbac.md` · `backend/reliability/caching.md` · `Stacks/Database.md` §2
