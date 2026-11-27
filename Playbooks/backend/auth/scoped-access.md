# Access limited to a branch or store

- **Situation:** "the branch manager sees only his branch", store, department or project level access inside one company, reports per branch, a user assigned to several branches, "admin sees all".
- **Skip when:** access is only by tenant (`backend/data/multi-tenancy.md`) or only by record owner (`backend/auth/rbac.md`); no sub-scope exists.
- **Decision:** scope is a second filter below the tenant. The user's allowed scope ids are resolved server-side from membership rows, attached to the request context, and applied by one helper in every query; the request may only narrow within it, never choose it.

## Levels

| Level | Pick when |
|---|---|
| Minimum | One scope type (branch), scope helper in every query, scope never from the body |
| Standard | Several scopes per user, all-scopes admins, scoped reports, cache versioning, a route matrix test |
| Advanced | Hierarchies (region > branch), time-limited scope grants, RLS on scope |

## Rules

### Minimum — always, never cut

- A table owned by a scope has `BranchId NOT NULL` next to `TenantId`; indexes start `(TenantId, BranchId, …)`.
- Allowed scope ids come from `UserScopes` rows read on the server (or the cached set, see Standard); never from a header, query string or body field.
- A client-sent `BranchId` filter is intersected with the allowed set: `inArray(T.BranchId, Allowed ∩ Requested)`. Requested outside the allowed set returns `404`/empty, never the data.
- One helper `InScope(Table, Scope)` builds the condition; handlers never write scope conditions by hand. A user with an empty allowed set sees nothing (`false`, not "no filter").
- Applies to every read, write, export, report, count, autocomplete, search and file download, including ones added later: a test enumerates the router and fails on any scoped-table route that does not use the helper.
- Inserts take `BranchId` from the allowed set: a requested value outside it is rejected, and a single-scope user gets theirs by default.
- Fetch-by-id loads with the scope condition in the query (not-yours is `404`).

### Standard — adds

- `UserScopes (TenantId, UserId, BranchId)` unique; a user may hold many. `AllScopes` is a flag on the membership or role, not a list of every branch, so new branches are included automatically.
- Aggregates and reports run with the scope helper too; a report row can only come from allowed scopes, and totals are recomputed on the filtered set, never subtracted from a global total.
- Moving a record between scopes is a permission of its own (`Records.Transfer`), needs access to both source and target, writes an audit row with both ids, and moves dependent rows (lines, payments, files) in the same transaction.
- Cached permission or scope sets are keyed by `(UserId, ScopeVersion)`; any change to `UserScopes`, an all-scopes flag or a role bumps the version in the same transaction as the change (`backend/auth/sessions.md`, `backend/reliability/caching.md`).
- Cached query results and list counts include the scope set hash in the key.
- Deleting or deactivating a branch removes it from `UserScopes` and keeps its history readable only to all-scopes users.

### Advanced — adds

- Hierarchies: scopes stored with a path (`ltree` or closure table); access to a parent includes descendants resolved in SQL, not by loops.
- Time-limited grants (cover for a colleague) with `ExpiresAt`, auto-expired and audited.
- RLS with `app.scope_ids` as a second line, set per transaction like the tenant.

## Edge cases

| Case | Expected behaviour |
|---|---|
| User's scope removed while signed in | Next request after the version bump sees nothing from that scope; access token claims never carry the scope list |
| Admin with all scopes opens a branch filter | Filter narrows; with no filter they get all branches in the tenant, never other tenants |
| User in branches A and B, no filter sent | Rows from A and B; counts and totals cover both |
| Record moved A to B while a user of A has it open | Their next read or save is `404`; saving an edit made before the move fails and shows "moved" |
| Report endpoint added without the helper | Route-enumeration test fails the build |
| Related row in another scope (invoice line pointing at a product held by another branch) | Parent scope decides access; the child is loaded through the parent, never by its own id alone |
| Shared catalogue (products visible to all branches, stock per branch) | Catalogue tables have no `BranchId`; stock and sales tables do |
| New branch created | All-scopes users see it at once; others only after assignment |
| 100×: 500 branches, user with 300 | Pass an indexed join to `UserScopes` rather than a 300-item `IN` list; keep `(TenantId, BranchId)` leading |
| Twice / parallel: two admins reassign the same user's scopes | `Version` check on the user's scope form; both audited; ScopeVersion bumped each time |

## Example — Standard, Bun + Hono + Drizzle

```ts
export type TScope = { TenantId: string; All: boolean; BranchIds: string[] }

export const ScopeMiddleware = createMiddleware<AppEnv>(async (c, Next) => {
  const User = c.get("User")
  const Scope = await LoadScope(User.TenantId, User.Id, User.ScopeVersion)
  c.set("Scope", Scope)
  await Next()
})

export function InScope(Table: { TenantId: PgColumn; BranchId: PgColumn }, Scope: TScope, Requested?: string[]) {
  const Base = eq(Table.TenantId, Scope.TenantId)
  if (Scope.All) return Requested?.length ? and(Base, inArray(Table.BranchId, Requested)) : Base
  const Allowed = Requested?.length ? Requested.filter((Id) => Scope.BranchIds.includes(Id)) : Scope.BranchIds
  return Allowed.length ? and(Base, inArray(Table.BranchId, Allowed)) : sql`false`
}

app.get("/sales", Require("Sales.View"), async (c) => {
  const Scope = c.get("Scope")
  const Rows = await db.select().from(Sales)
    .where(InScope(Sales, Scope, c.req.queryAll("BranchId")))
    .orderBy(desc(Sales.CreatedAt)).limit(50)
  return c.json({ Data: Rows })
})

export async function MoveSale(Scope: TScope, SaleId: string, TargetBranchId: string) {
  return db.transaction(async (Tx) => {
    const [Sale] = await Tx.select().from(Sales).where(and(eq(Sales.Id, SaleId), InScope(Sales, Scope))).for("update")
    if (!Sale || !CanAccess(Scope, TargetBranchId)) throw new AppError("NOT_FOUND", 404)
    await Tx.update(Sales).set({ BranchId: TargetBranchId }).where(eq(Sales.Id, SaleId))
    await Tx.update(SaleLines).set({ BranchId: TargetBranchId }).where(eq(SaleLines.SaleId, SaleId))
    await WriteAudit(Tx, "Sale.Moved", { SaleId, From: Sale.BranchId, To: TargetBranchId })
  })
}
```

`LoadScope` reads from cache keyed by `ScopeVersion`. The filter is a pure function of the server-side scope plus a narrowing request, so no handler can widen it; the move locks the row in scope, checks the target, and moves children together.

Other stacks: Prisma client extension that injects the scope `where` on scoped models; Laravel global scope reading the scope from the authenticated user.

## Verify

- [ ] `[M]` Sending `BranchId` of a foreign branch in query, body and header never returns or changes its rows.
- [ ] `[M]` A route-enumeration test fails when a scoped-table route skips `InScope`.
- [ ] `[M]` A user with no scopes gets empty lists, not everything.
- [ ] `[S]` Removing a user's scope takes effect on the next request despite the cache.
- [ ] `[S]` Report totals for a two-branch user equal the sum of the two branches' own reports.
- [ ] `[S]` Moving a sale moves its lines and payments and writes one audit row.

## Pitfalls

- **Scope filter only on list endpoints** → export, report and `GET /:id` leak → helper everywhere plus the enumeration test.
- **Scope ids inside the JWT** → stale until expiry → resolve per request from a versioned cache.
- **Empty allowed set becomes "no filter"** → full leak → return `sql\`false\``.
- **`AllScopes` stored as a list of branch ids** → new branches invisible to admins → use a flag.
- **Admin report summing a global total minus others** → leaks totals → filter, then aggregate.

## Related

`backend/data/multi-tenancy.md` · `backend/auth/rbac.md` · `backend/auth/sessions.md` · `backend/reliability/caching.md` · `backend/data/audit-log.md` · `backend/data/concurrency.md`
