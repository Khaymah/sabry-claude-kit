# Password reset

- **Situation:** "forgot password", reset link by email, magic sign-in link, email verification link. Any one-time token sent out of band. Not for OTP codes typed by hand (`auth/otp.md`).
- **Decision:** a 32-byte random token, stored only as its SHA-256 hash, valid 30 minutes, used once, and every reset ends all of the user's sessions.

## Rules

- The request endpoint returns the same response and takes about the same time whether the email exists or not.
- Generate with a CSPRNG (`crypto.getRandomValues`), 32 bytes, base64url. Never a UUID, a timestamp or a JWT.
- Store `SHA-256(token)`, never the token. A fast hash is right here: the token has 256 bits of entropy, unlike a password.
- One active token per user and purpose: issuing a new one deletes the old ones.
- Consume atomically: one `UPDATE … WHERE "TokenHash" = $1 AND "UsedAt" IS NULL AND "ExpiresAt" > now() RETURNING`. No row means invalid, whatever the reason.
- After the password changes: revoke every refresh token / session of the user, and send a "your password was changed" email.
- Rate-limit the request endpoint per email and per IP (`reliability/rate-limit.md`).
- The link points to the frontend page; the page POSTs the token in the body. The token never goes in a GET that changes state, and never in logs or analytics.
- The reset page sends `Referrer-Policy: no-referrer` so the token does not leak to third-party scripts.
- Lifetime, link base URL and email template come from `SystemSettings`, not env.

## Example — Bun + Hono + Drizzle

```ts
export const PasswordResetTokens = pgTable("PasswordResetTokens", {
  ...BaseColumns,
  UserId: uuid("UserId").notNull().references(() => Users.Id, { onDelete: "cascade" }),
  TokenHash: text("TokenHash").notNull().unique(),
  ExpiresAt: timestamp("ExpiresAt", { withTimezone: true }).notNull(),
  UsedAt: timestamp("UsedAt", { withTimezone: true }),
}, (T) => [index().on(T.UserId)])

const HashToken = async (Token: string) =>
  Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(Token))).toString("hex")

export async function RequestReset(Email: string) {
  const User = await db.query.Users.findFirst({ where: and(eq(Users.Email, Email.toLowerCase()), NotDeleted(Users)) })
  if (!User) return
  const Token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")
  await db.transaction(async (Tx) => {
    await Tx.delete(PasswordResetTokens).where(eq(PasswordResetTokens.UserId, User.Id))
    await Tx.insert(PasswordResetTokens).values({
      UserId: User.Id,
      TokenHash: await HashToken(Token),
      ExpiresAt: new Date(Date.now() + GetSetting("Auth.ResetTokenMinutes") * 60_000),
    })
  })
  await EventBus.Emit("Auth.PasswordResetRequested", { UserId: User.Id, Token })
}

export async function ResetPassword(Token: string, NewPassword: string) {
  const [Row] = await db.update(PasswordResetTokens)
    .set({ UsedAt: new Date() })
    .where(and(
      eq(PasswordResetTokens.TokenHash, await HashToken(Token)),
      isNull(PasswordResetTokens.UsedAt),
      gt(PasswordResetTokens.ExpiresAt, new Date()),
    ))
    .returning({ UserId: PasswordResetTokens.UserId })
  if (!Row) throw new AppError("AUTH_RESET_INVALID", 400)
  await db.transaction(async (Tx) => {
    await Tx.update(Users).set({ PasswordHash: await Bun.password.hash(NewPassword) }).where(eq(Users.Id, Row.UserId))
    await Tx.update(RefreshTokens).set({ RevokedAt: new Date() }).where(and(eq(RefreshTokens.UserId, Row.UserId), isNull(RefreshTokens.RevokedAt)))
  })
  await EventBus.Emit("Auth.PasswordChanged", { UserId: Row.UserId })
}
```

The controller for `RequestReset` always answers `200 { Success: true, Message: "auth.reset_sent_if_exists" }`; the email is sent by the event handler through the job queue, so the response time does not reveal whether the user exists.

Other stacks: Node `crypto.randomBytes(32)` and `createHash("sha256")`; Laravel's built-in broker already hashes and expires, keep it and add session revocation.

## Verify

- [ ] Unknown email and known email: same status, same body, response times within the same range.
- [ ] The database holds no plaintext token (`SELECT "TokenHash"` is 64 hex chars).
- [ ] The same token used twice: second call fails.
- [ ] Token older than the lifetime: fails.
- [ ] Two tokens requested: only the newest works.
- [ ] After a reset, an old refresh token is rejected.
- [ ] Twenty requests a minute for one email: throttled.

## Pitfalls

- **"No account with this email"** → user enumeration → one generic answer.
- **Sending the email inside the request** → timing reveals existence and SMTP errors leak → send from a queued job.
- **`SELECT` then `UPDATE` to mark used** → two parallel clicks both succeed → one conditional `UPDATE … RETURNING`.
- **JWT as the reset token** → cannot be revoked, often long-lived → random token in the database.
- **Keeping sessions alive after the reset** → the attacker who caused the reset stays signed in → revoke all.

## Related

`auth/sessions.md` · `reliability/rate-limit.md` · `reliability/background-jobs.md` · `Stacks/Bun-Hono.md` §Auth
