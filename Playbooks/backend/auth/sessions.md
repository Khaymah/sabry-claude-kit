# Sessions: sign-in, refresh and sign-out

- **Situation:** sign-in and sign-out, "remember me", access and refresh tokens, JWT, cookies, mobile sessions, "log out of all devices", a device list.
- **Skip when:** auth is a managed service (Clerk, Auth0, Supabase Auth, Firebase); use its SDK and add only what it lacks.
- **Decision:** (owner stack; token type, lifetimes and cookie name and path follow the project's existing auth, and only a project with none gets these defaults) a short-lived access JWT (15 min, `jose`) sent in `Authorization: Bearer`, plus a long-lived **rotating** refresh token: random, stored only as a hash, one row per device, sent as an `httpOnly; Secure; SameSite` cookie on the web and kept in secure storage on mobile. Reusing an already-rotated refresh token revokes the whole device session.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Internal tool: hashed passwords, hashed refresh tokens, sign-out revokes |
| Standard | Public production: rotation with reuse detection, device list, sign-in throttling |
| Advanced | Money, admin panels, sensitive data: 2FA, new-device alerts, step-up for sensitive actions |

## Rules

### Minimum — always, never cut

- Passwords: `Bun.password.hash` (argon2id) / `verify`; minimum length 10, checked against a small breached-passwords list; no maximum below 128.
- Sign-in answers the same `401 AUTH_INVALID` for unknown email and wrong password.
- Refresh token (type and lifetime follow existing auth; defaults shown): 32 random bytes, stored as SHA-256 in `RefreshTokens` (`UserId`, `TokenHash`, `ExpiresAt`, `RevokedAt`, `DeviceName`, `LastUsedAt`); lifetime 30 days.
- Web cookie (name and path follow existing auth; the flags below stay mandatory): `HttpOnly; Secure; SameSite=Lax; Path=/api/v1/auth`; the access token lives in memory in the SPA, never in `localStorage`.
- Sign-out revokes the device's refresh token; password change and reset revoke all of the user's tokens.
- JWT: `HS256` with a secret from `SystemSettings` (or `EdDSA` when other services verify), `exp` 15 min, `sub` = user id, `iss`/`aud` checked, 30 s clock leeway.

### Standard — adds

- Rotation: every refresh issues a new refresh token and marks the old one replaced (`ReplacedById`). Presenting a replaced token → revoke that device's chain and return `401`.
- A 20-second grace window for the just-replaced token returns the same new pair, so two tabs refreshing at once don't trigger reuse detection.
- Sign-in throttling: per account (e.g. 5 failures → 15 min backoff) and per IP (`backend/reliability/rate-limit.md`); never a permanent lock an attacker can trigger.
- Devices view: list active refresh tokens with device name and last use; revoke one or all.
- Access tokens carry `PermissionsVersion`; a role change bumps it, and the auth middleware rejects stale tokens for permission-sensitive routes (cached lookup, not a DB hit per request).

### Advanced — adds

- 2FA (TOTP, `backend/auth/otp.md`) with hashed recovery codes; required for admins.
- New-device sign-in email or push; step-up (re-enter password or 2FA) for changing email, password, payout details.
- Refresh tokens bound to the device (a device key on mobile) where the platform supports it.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Access token expired mid-request burst | The client refreshes once (single in-flight refresh), then retries the queued requests |
| User deleted or disabled | Refresh fails (join on an active user); access tokens die within 15 min, or at once for sensitive routes via `PermissionsVersion` |
| Stolen refresh token used after the real client rotated | Reuse detected → whole chain revoked → real user signs in again; event logged |
| Mobile app offline for 40 days | Refresh token expired → sign-in screen, no silent failure loop |
| CSRF on the refresh cookie | Refresh endpoint is `POST`, checks `Origin` against allowed origins; the cookie is `SameSite=Lax` and scoped to the auth path |
| 100×: millions of refresh rows | Index on `TokenHash` (unique) and `(UserId, RevokedAt)`; a daily job deletes expired rows |
| Twice / parallel: two tabs refresh at once | The grace window returns the same new pair to both |

## Example — Standard, Bun + Hono

The sample uses the owner's default token, cookie name and path; keep the project's own.

```ts
export async function Refresh(c: Context, Presented: string) {
  const Hash = await Sha256Hex(Presented)
  const Row = await db.query.RefreshTokens.findFirst({ where: eq(RefreshTokens.TokenHash, Hash) })
  if (!Row || Row.RevokedAt || Row.ExpiresAt < new Date()) throw new AppError("AUTH_INVALID", 401)
  if (Row.ReplacedById) {
    if (Date.now() - Row.ReplacedAt!.getTime() < 20_000) return ReissueFor(Row.ReplacedById)
    await RevokeChain(Row.ChainId)
    Logger.warn({ UserId: Row.UserId, ChainId: Row.ChainId }, "refresh token reuse")
    throw new AppError("AUTH_INVALID", 401)
  }
  const Next = RandomToken()
  const NewId = await db.transaction(async (Tx) => {
    const [Created] = await Tx.insert(RefreshTokens).values({
      UserId: Row.UserId, ChainId: Row.ChainId, TokenHash: await Sha256Hex(Next), DeviceName: Row.DeviceName,
      ExpiresAt: sql`now() + interval '30 days'`,
    }).returning({ Id: RefreshTokens.Id })
    const [Marked] = await Tx.update(RefreshTokens)
      .set({ ReplacedById: Created.Id, ReplacedAt: sql`now()`, LastUsedAt: sql`now()` })
      .where(and(eq(RefreshTokens.Id, Row.Id), isNull(RefreshTokens.ReplacedById)))
      .returning({ Id: RefreshTokens.Id })
    if (!Marked) throw new AppError("AUTH_RETRY", 409)
    return Created.Id
  })
  setCookie(c, "Refresh", Next, { httpOnly: true, secure: true, sameSite: "Lax", path: "/api/v1/auth", maxAge: 30 * 86_400 })
  return { AccessToken: await SignAccess(Row.UserId), RefreshId: NewId }
}
```

`ReissueFor` returns the pair already issued for the grace window from a 20-second cache keyed by the new token id; the conditional update makes two simultaneous refreshes of the same token produce one rotation.

Other stacks: Next.js with Auth.js database sessions is fine when the project uses it; Laravel Sanctum for SPA cookie sessions.

## Verify

- [ ] `[M]` No plaintext refresh token in the database; no access token in `localStorage` (`grep -rn localStorage src/`).
- [ ] `[M]` Wrong password and unknown email return the same body.
- [ ] `[M]` After sign-out, the old refresh token returns 401.
- [ ] `[S]` Replaying a rotated token after 30 s revokes the chain.
- [ ] `[S]` Two parallel refreshes with the same token both succeed with the same new pair.
- [ ] `[S]` Six wrong passwords in a minute are throttled.
- [ ] `[A]` Admin sign-in without 2FA is refused.

## Pitfalls

- **Long-lived JWT with no refresh** → can't revoke a stolen token → 15-minute access + revocable refresh.
- **Tokens in `localStorage`** → any XSS steals sessions → memory + httpOnly cookie.
- **Rotation without a grace window** → users logged out by their own tabs → 20 s grace.

## Related

`backend/auth/password-reset.md` · `backend/auth/rbac.md` · `backend/auth/otp.md` · `Stacks/Bun-Hono.md` §Auth
