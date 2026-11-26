# Roles and permissions

- **Situation:** admin vs user, "only the owner can edit", staff roles, permissions screens, hiding buttons, "a user saw another user's order" (IDOR), multi-level access in a dashboard.
- **Skip when:** never: even a single-user app checks that a resource belongs to the requester.
- **Decision:** two checks on every request. **Permission:** can this user do this kind of action (`Orders.Refund`)? checked in route middleware from roles → permissions. **Ownership:** is this specific record theirs (or their tenant's)? enforced in the query itself, so a foreign id simply isn't found. Deny by default.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Fixed roles in code (`Admin`, `User`) + ownership in every query |
| Standard | Permissions as strings, roles configurable by the client, a permission matrix test |
| Advanced | Policies on attributes (department, amount limits), temporary elevation, field-level rules |

## Rules

### Minimum — always, never cut

- Every query that loads a user-owned record includes the owner or tenant condition (`and(eq(Orders.Id, Id), eq(Orders.CustomerId, User.Id))`). Never load by id and then compare in JS.
- Not found and not yours both return `404`, so ids can't be probed.
- Role checks happen in middleware on the route, never only in the frontend; hiding a button is UX, not security.
- Every new route is denied unless it declares its requirement (`Public`, `Authenticated`, or `Require("X.Y")`); a test fails on routes without one.

### Standard — adds

- Permissions are `Module.Action` strings declared in code (`PERMISSIONS` registry); roles are rows (`Roles`, `RolePermissions`, `UserRoles`) the client's admin can edit, within the registry.
- The user's permission set is cached per user with a version; role edits bump the version (`backend/auth/sessions.md` `PermissionsVersion`).
- A matrix test: for every route, each role gets the expected 2xx or 403/404.
- Role and permission changes are audit-logged (`backend/data/audit-log.md`); a user can't grant permissions they don't have.
- Admin actions on another user's data go through admin routes with their own permission, never by reusing user routes with a flag.

### Advanced — adds

- Policies for rules beyond roles: `CanApproveRefund(User, Refund)` checks amount limits, department, status; policies live in one module with tests per rule.
- Temporary elevation (time-boxed role grant with a reason), auto-expired by a job.
- Field-level rules: sensitive fields (cost price, salary) stripped by the response shaper unless the permission is present.

## Edge cases

| Case | Expected behaviour |
|---|---|
| User removed from a role while signed in | Sensitive routes reject at once (version bump); others within the access token's 15 minutes |
| Last admin removes their own admin role | Refused: at least one admin must remain |
| Shared resource (a project with members) | Ownership check becomes membership: `exists(ProjectMembers where ProjectId and UserId)` in the query |
| Bulk endpoint with 50 ids, 3 not owned | The query returns only owned ones; response lists the ids not found; nothing leaks about the 3 |
| Nested resource (`/projects/:P/tasks/:T`) | Task loaded with both `ProjectId = :P` and the project's ownership; a task id from another project is 404 |
| 100×: 200 permissions, 30 roles | Still one cached set per user; checks are a `Set.has` |
| Twice / parallel: two admins change the same user's roles | Last write wins on the set, both audited; the `Version` rule applies to the roles form |

## Example — Standard, Bun + Hono

```ts
export const PERMISSIONS = ["Orders.View", "Orders.Refund", "Products.Edit", "Settings.Payments", "Users.Manage"] as const
export type TPermission = (typeof PERMISSIONS)[number]

export const Require = (Permission: TPermission) => createMiddleware<AppEnv>(async (c, Next) => {
  const User = c.get("User")
  if (!User) throw new AppError("AUTH_REQUIRED", 401)
  const Granted = await PermissionsOf(User.Id, User.PermissionsVersion)
  if (!Granted.has(Permission)) throw new AppError("FORBIDDEN", 403)
  await Next()
})

OrdersRoutes.post("/:Id/refund", Auth, Require("Orders.Refund"), zValidator("json", RefundSchema), OrdersController.Refund)

export async function GetMyOrder(UserId: string, OrderId: string) {
  const Order = await db.query.Orders.findFirst({
    where: and(eq(Orders.Id, OrderId), eq(Orders.CustomerId, UserId), NotDeleted(Orders)),
    columns: { Id: true, Status: true, TotalMinor: true, Currency: true, CreatedAt: true },
  })
  if (!Order) throw new AppError("ORDER_NOT_FOUND", 404)
  return Order
}
```

`PermissionsOf` reads an LRU cache keyed by `UserId:Version`, loading roles and permissions in one query on a miss.

## Verify

- [ ] `[M]` Requesting another user's record by id returns 404 (one test per resource type).
- [ ] `[M]` Every route declares `Public`, `Auth` or `Require(...)`; a route-listing test fails otherwise.
- [ ] `[S]` Matrix test passes for all roles × routes.
- [ ] `[S]` Removing a permission blocks the sensitive route immediately.
- [ ] `[S]` Role changes appear in the audit log.
- [ ] `[A]` Each policy rule has a test for allow and deny.

## Pitfalls

- **`findFirst({ where: eq(X.Id, Id) })` then `if (X.UserId !== User.Id)`** → easy to forget once → ownership in the query.
- **403 for others' records** → confirms the id exists → 404.
- **Permission checks only in the UI** → direct API calls bypass them → middleware.

## Related

`backend/data/multi-tenancy.md` · `backend/auth/sessions.md` · `backend/data/audit-log.md` · `quality/TRAPS.md` §Security
