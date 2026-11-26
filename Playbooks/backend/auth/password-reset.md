# Password reset

- **Situation:** "forgot password", reset link by email, magic sign-in link, email verification link. Any one-time token sent out of band. OTP codes typed by hand: `auth/otp.md`.
- **Skip when:** auth is a managed service (Clerk, Auth0, Supabase Auth, Firebase Auth, Laravel's password broker): use its flow and only add what the Standard level lists that it lacks (usually session revocation).
- **Decision:** a 32-byte random token, stored only as its SHA-256 hash, short-lived, consumed once by an atomic update; the response never reveals whether the account exists.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Internal tool or prototype; a handful of known users |
| Standard | Any public sign-up, any production app |
| Advanced | Admin panels, money or wallets, sensitive data, accounts worth taking over |

## Rules

### Minimum — always, never cut

- Token from a CSPRNG (`crypto.getRandomValues`), 32 bytes, base64url. Never a UUID, a timestamp or a JWT.
- Store `SHA-256(token)`, never the token. A fast hash is right here: the token has 256 bits of entropy, unlike a password.
- Lifetime 30 minutes; one active token per user and purpose (issuing a new one deletes the old ones).
- Consume with one `UPDATE … WHERE "TokenHash" = $1 AND "UsedAt" IS NULL AND "ExpiresAt" > now() RETURNING`. No row means invalid, whatever the reason; one error message for all reasons.
- The request endpoint returns the same body for known and unknown emails.
- The link opens a frontend page; the page POSTs the token. A GET never consumes it.

### Standard — adds

- Revoke every session / refresh token of the user after the reset, and email "your password was changed".
- Send the email from a queued job, so response time does not reveal whether the account exists.
- Rate-limit the request endpoint per email and per IP (`reliability/rate-limit.md`).
- `Referrer-Policy: no-referrer` on the reset page; the token never reaches logs or analytics.
- Lifetime, link base URL and template from `SystemSettings`.

### Advanced — adds

- Lifetime 15 minutes. Accounts with 2FA must pass the second factor after the reset before a session starts.
- Audit row for request and completion (user, IP, user agent); alert the user from a channel other than the email when possible (SMS, push).
- An admin can't reset someone else's password directly: they trigger the same email flow.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Mail scanners (Outlook Safe Links, Gmail) open the link before the user | Nothing is consumed: the page loads, only its POST uses the token |
| User clicks an old email after requesting a new one | Generic "link expired or invalid", with a button to request again |
| Two tabs submit the same token | One succeeds, the other gets the generic invalid error |
| Email changed after the token was issued | Changing the email deletes the user's pending reset tokens |
| Account disabled or deleted after the token was issued | Consume fails: the update joins on an active, non-deleted user |
| Account created with Google / Apple only, no password | Same generic response; the email says "you sign in with Google" instead of a link (or sets a first password, if the product allows it) |
| Unverified email address | A successful reset also marks the email verified: the user proved they own it |
| Email client breaks the URL or changes case | base64url has no `+ / =`; the page trims whitespace; tokens compare exactly |
| App server clock differs from the database | Expiry is compared with the database's `now()`, never the app's clock |
| New password equals the old one or fails the policy | Rejected by the same validator as sign-up; the token is **not** consumed (validate first, then consume) |

## Example — Standard, Bun + Hono + Drizzle

```ts
export const PasswordResetTokens = pgTable("PasswordResetTokens", {
  ...BaseColumns,
  UserId: uuid("UserId").notNull().references(() => Users.Id, { onDelete: "cascade" }),
  TokenHash: text("TokenHash").notNull().unique(),
  ExpiresAt: timestamp("ExpiresAt", { withTimezone: true }).notNull(),
  UsedAt: timestamp("UsedAt", { withTimezone: true }),
}, (T) => [index().on(T.UserId)])

const HashToken = async (Token: string) =>
  Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(Token.trim()))).toString("hex")

export async function RequestReset(Email: string) {
  const User = await db.query.Users.findFirst({ where: and(eq(Users.Email, Email.trim().toLowerCase()), NotDeleted(Users)) })
  if (!User) return
  const Token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")
  const Minutes = GetSetting("Auth.ResetTokenMinutes")
  await db.transaction(async (Tx) => {
    await Tx.delete(PasswordResetTokens).where(eq(PasswordResetTokens.UserId, User.Id))
    await Tx.insert(PasswordResetTokens).values({
      UserId: User.Id,
      TokenHash: await HashToken(Token),
      ExpiresAt: sql`now() + make_interval(mins => ${Minutes})`,
    })
  })
  await Jobs.Enqueue("Auth.SendResetEmail", { UserId: User.Id, Token })
}

export async function ResetPassword(Token: string, NewPassword: string) {
  PasswordPolicy.parse(NewPassword)
  const PasswordHash = await Bun.password.hash(NewPassword)
  const UserId = await db.transaction(async (Tx) => {
    const [Row] = await Tx.update(PasswordResetTokens)
      .set({ UsedAt: sql`now()` })
      .where(and(
        eq(PasswordResetTokens.TokenHash, await HashToken(Token)),
        isNull(PasswordResetTokens.UsedAt),
        gt(PasswordResetTokens.ExpiresAt, sql`now()`),
        exists(Tx.select().from(Users).where(and(eq(Users.Id, PasswordResetTokens.UserId), NotDeleted(Users), eq(Users.IsActive, true)))),
      ))
      .returning({ UserId: PasswordResetTokens.UserId })
    if (!Row) throw new AppError("AUTH_RESET_INVALID", 400)
    await Tx.update(Users).set({ PasswordHash, EmailVerifiedAt: sql`coalesce("EmailVerifiedAt", now())` }).where(eq(Users.Id, Row.UserId))
    await Tx.update(RefreshTokens).set({ RevokedAt: sql`now()` }).where(and(eq(RefreshTokens.UserId, Row.UserId), isNull(RefreshTokens.RevokedAt)))
    return Row.UserId
  })
  await Jobs.Enqueue("Auth.SendPasswordChangedEmail", { UserId })
}
```

The controller for `RequestReset` always answers `200 { Success: true, Message: "auth.reset_sent_if_exists" }`. Minimum drops the `RefreshTokens` revocation, the queue (send inline) and the settings lookup.

Other stacks: Node `crypto.randomBytes(32)` + `createHash("sha256")`; Laravel keeps its broker and adds session revocation in the `PasswordReset` event listener.

## Verify

- [ ] `[M]` Unknown and known email: same status and body.
- [ ] `[M]` The table holds no plaintext token (`TokenHash` is 64 hex chars).
- [ ] `[M]` Same token twice: second fails. Expired token: fails. Older of two tokens: fails.
- [ ] `[M]` A GET on the link changes nothing in the database.
- [ ] `[M]` Weak new password: rejected and the token still works afterwards.
- [ ] `[S]` After a reset, an old refresh token is rejected.
- [ ] `[S]` Response times for known and unknown emails are in the same range (no inline SMTP).
- [ ] `[S]` Twenty requests a minute for one email: throttled.
- [ ] `[A]` A 2FA account gets no session until the second factor passes.

## Pitfalls

- **"No account with this email"** → user enumeration → one generic answer.
- **`SELECT` then `UPDATE` to mark used** → two parallel clicks both succeed → one conditional `UPDATE … RETURNING`.
- **Consuming the token before validating the new password** → user's typo burns the link → validate, then consume.
- **JWT as the reset token** → cannot be revoked, often long-lived → random token in the database.
- **Keeping sessions alive after the reset** → the attacker who caused the reset stays signed in → revoke all.

## Related

`auth/sessions.md` · `auth/otp.md` · `reliability/rate-limit.md` · `reliability/background-jobs.md` · `Stacks/Bun-Hono.md` §Auth
