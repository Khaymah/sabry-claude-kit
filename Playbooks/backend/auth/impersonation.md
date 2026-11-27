# Support "login as user"

- **Situation:** support staff need to see what a customer sees, "login as this user", "view as", reproducing a customer's bug, admin acting on behalf of a user.
- **Skip when:** support can solve it from an admin screen showing the user's data; or screen-share is enough.
- **Decision:** impersonation is a separate, short-lived session type, not a password or token borrowed from the user. It is explicit (reason and ticket required), time-boxed, read-only by default, visibly bannered, limited to equal or lower roles, and every action is attributed to both people.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Internal support tool: permission, reason, 30-minute cap, banner, audit |
| Standard | Customers' data at stake: + read-only default with per-action write opt-in, role ceiling, blocked actions, customer notice |
| Advanced | Regulated or enterprise: two-person approval, tenant opt-in, session recording of actions, automatic expiry reports |

## Rules

### Minimum — always, never cut

- Only users with `Users.Impersonate` can start it, through an admin route of its own (`backend/auth/rbac.md`); never a query flag on normal routes.
- Start requires `TargetUserId` and a free-text `Reason` (and ticket id if the project has tickets); both are stored.
- The session is a new row (`ImpersonationSessions`: `ActorId`, `TargetId`, `Reason`, `StartedAt`, `ExpiresAt`, `EndedAt`) and a new access token whose claims carry `Sub = TargetId` and `Act = ActorId`. The target's password, refresh token and existing sessions are never touched or reused.
- Hard expiry 30 minutes, no refresh and no silent extension; the actor ends it with a button, or starts a new one with a new reason.
- The actor cannot impersonate a user with a higher or equal privilege role, a platform admin, or themselves.
- Every response in the session shows a banner (target, actor, time left) and an "Exit" action; the frontend cannot hide it because the banner flag comes from the token.
- Audit rows for start, end, and every write made during the session carry both `ActorId` and `OnBehalfOf` (`backend/data/audit-log.md`).

### Standard — adds

- Read-only by default: the middleware rejects every non-`GET` request with `403 IMPERSONATION_READ_ONLY` unless the session was started with `AllowWrites` and a second reason.
- Always blocked, even with writes: change email or password, MFA reset, create or revoke API keys, payments and refunds, delete account, change roles, start another impersonation.
- Sensitive output stays masked: full card data, secrets, API key values, one-time codes, recovery codes.
- Sending email or SMS notifications the target would trigger is suppressed or marked as sent under support, unless the action is the point.
- The target user (or tenant owner) gets a notice after a session ends; the list of past sessions is visible to the tenant's admin.
- Rate-limit starts per actor; alert on more than N per day.

### Advanced — adds

- Tenant setting to allow or forbid support access; default is allowed only after the tenant grants it for a time window.
- Two-person approval for write sessions.
- Request log of the whole session kept with the audit row.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Actor's own role is reduced or the actor is disabled mid-session | Next request ends the session: the token's `Act` is re-checked against the actor's current permission and version |
| Target deleted, suspended or changes role up during the session | Session refused on next request with `409 TARGET_CHANGED` |
| Support impersonates a user, user logs in at the same time | Two independent sessions; the user's own session is unaffected and does not see the support one |
| Action performed in the session | Audit shows `ActorId`, `OnBehalfOf`, session id; user-facing "created by" shows the target and a "via support" mark |
| Background job started in the session | Job payload carries `ActorId` and runs with the same restrictions, or is refused if it writes |
| Cached data, files and signed URLs | Keys follow the target's tenant and scope; signed URLs issued in the session expire with it |
| Impersonating across tenants | Platform support only; the tenant context is set explicitly and audited (`backend/data/multi-tenancy.md`) |
| 100×: 100 support sessions a day, millions of audit rows | Audit table partitioned or indexed by `(OnBehalfOf, CreatedAt)`; sessions list paginated |
| Twice / parallel: actor starts two sessions for the same target, or clicks start twice | Partial unique index on active sessions per `(ActorId, TargetId)`; the second call returns the existing session |

## Example — Standard, Bun + Hono + Drizzle

```ts
export async function StartImpersonation(Actor: TUser, TargetId: string, Reason: string, AllowWrites: boolean) {
  if (Reason.trim().length < 10) throw new AppError("REASON_REQUIRED", 422)
  const Target = await db.query.Users.findFirst({ where: eq(Users.Id, TargetId) })
  if (!Target || Target.Id === Actor.Id || RoleRank(Target.Role) >= RoleRank(Actor.Role)) throw new AppError("FORBIDDEN", 403)
  const ExpiresAt = new Date(Date.now() + 30 * 60_000)
  const [Row] = await db.insert(ImpersonationSessions).values({ ActorId: Actor.Id, TargetId, Reason, AllowWrites, ExpiresAt })
    .onConflictDoNothing().returning()
  if (!Row) throw new AppError("ALREADY_ACTIVE", 409)
  await WriteAudit(db, "Impersonation.Started", { ActorId: Actor.Id, TargetId, Reason, SessionId: Row.Id })
  return SignAccessToken({ Sub: TargetId, Act: Actor.Id, Imp: Row.Id, Exp: ExpiresAt })
}

export const ImpersonationGuard = createMiddleware<AppEnv>(async (c, Next) => {
  const Claims = c.get("Claims")
  if (!Claims.Imp) return Next()
  const Session = await GetActiveImpersonation(Claims.Imp)
  if (!Session || Session.ExpiresAt < new Date()) throw new AppError("IMPERSONATION_ENDED", 401)
  if (c.req.method !== "GET" && !Session.AllowWrites) throw new AppError("IMPERSONATION_READ_ONLY", 403)
  if (BlockedWhileImpersonating(c.req.method, c.req.path)) throw new AppError("FORBIDDEN", 403)
  c.set("Impersonation", Session)
  c.header("X-Impersonating", Session.Id)
  await Next()
})
```

`WriteAudit` reads `c.get("Impersonation")` and always records both ids. The partial unique index `(ActorId, TargetId) WHERE EndedAt IS NULL` makes the double start safe.

Other stacks: Laravel's `Auth::login` of the target is unsafe here; mint a distinct guard or token with an `act` claim instead.

## Verify

- [ ] `[M]` Starting without a reason, on yourself, or on a higher role fails.
- [ ] `[M]` After 30 minutes the token is rejected, no refresh possible.
- [ ] `[M]` Audit rows for a write during the session show both actor and target.
- [ ] `[S]` A `POST` in a read-only session returns `403 IMPERSONATION_READ_ONLY`; changing the target's password is blocked even with writes.
- [ ] `[S]` Disabling the actor kills the session on its next request.

## Pitfalls

- **Reusing the target's session or resetting their password** → leaks credentials, logs the user out → mint a separate token.
- **Banner rendered by the frontend from local state** → can vanish → derive it from the token claim on each page.
- **Audit stores only the target id** → support actions look like the user's → record `ActorId` too.
- **Role ceiling checked once at start** → privilege changes mid-session ignored → recheck per request.

## Related

`backend/auth/rbac.md` · `backend/auth/sessions.md` · `backend/data/audit-log.md` · `backend/data/multi-tenancy.md` · `backend/reliability/rate-limit.md`
