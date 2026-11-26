# One-time codes (SMS, WhatsApp, email) and 2FA

- **Situation:** phone verification, sign-in by code, "send me a code on WhatsApp", two-factor authentication, authenticator apps, recovery codes.
- **Skip when:** a link works better (email verification and password reset use links: `backend/auth/password-reset.md`).
- **Decision:** 6-digit codes from a CSPRNG, stored hashed, valid 5 minutes, at most 5 attempts per code, resend cooldown, and hard rate limits per destination, per IP and per country because SMS costs money and attackers abuse it (SMS pumping). 2FA uses TOTP (authenticator apps) with hashed recovery codes; SMS is a fallback, not the default.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Phone or email verification only |
| Standard | Sign-in by code or optional 2FA in production |
| Advanced | Mandatory 2FA, high-value accounts, SMS spend at scale |

## Rules

### Minimum — always, never cut

- Code: 6 digits from `crypto.getRandomValues` (no `Math.random`), stored as HMAC-SHA256 with a server secret (6 digits are guessable offline, so a plain hash is not enough).
- One active code per `(Destination, Purpose)`; a new code replaces the old.
- Expires in 5 minutes; 5 wrong attempts invalidate it.
- Verification is one conditional update (`… AND "Attempts" < 5 AND "ExpiresAt" > now() AND "UsedAt" IS NULL`), like password reset tokens.
- Resend cooldown 60 s; rate limit per destination (e.g. 5 per hour) and per IP.
- The same response whether the phone or email exists or not.

### Standard — adds

- SMS pumping defence: allow-list of countries the business serves, daily SMS budget with an alert, CAPTCHA (Turnstile) after the first resend.
- WhatsApp OTP through an approved template (authentication category), SMS as fallback; provider choice and keys in `SystemSettings`.
- TOTP 2FA: secret generated server-side, shown as QR once, stored encrypted (`Stacks/Database.md` §1 encryption), enabled only after the user enters a valid code; 30 s window ±1 step; the last used step stored to block replay.
- 10 recovery codes, shown once, stored hashed, each single use.
- Phone numbers normalised to E.164 (`libphonenumber-js`) before any lookup or limit.

### Advanced — adds

- 2FA mandatory for admins and staff; step-up 2FA for sensitive actions.
- Passkeys (WebAuthn) as the preferred second factor or passwordless sign-in.
- Per-provider delivery metrics (sent, delivered, verified) to detect a broken route or fraud.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Egyptian number typed as `010…`, `+2010…`, `002010…` | All normalise to `+2010…`; one rate-limit bucket |
| Code delivered after it expired (slow SMS) | Expired; resend allowed after the cooldown; the UI says the code expires in 5 minutes |
| User requests 3 codes, enters the first | Invalid: only the newest is active |
| Attacker tries 1,000 numbers from one IP | IP limit and country allow-list stop it; budget alert fires |
| User loses the authenticator phone | Recovery code, or support flow with identity checks, audit-logged |
| 100×: SMS volume 100× | Budget per day enforced; provider failover; costs reviewed weekly |
| Twice / parallel: the same code submitted twice at once | The conditional update lets one succeed; the other is invalid |

## Example — Standard, Bun + Drizzle

```ts
const HmacCode = async (Code: string, Destination: string) => {
  const Key = await crypto.subtle.importKey("raw", new TextEncoder().encode(GetSetting("Auth.OtpSecret")), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  const Sig = await crypto.subtle.sign("HMAC", Key, new TextEncoder().encode(`${Destination}:${Code}`))
  return Buffer.from(Sig).toString("hex")
}

export async function VerifyOtp(Destination: string, Purpose: string, Code: string) {
  const Candidate = await HmacCode(Code, Destination)
  const [Hit] = await db.update(OtpCodes)
    .set({ UsedAt: sql`now()` })
    .where(and(eq(OtpCodes.Destination, Destination), eq(OtpCodes.Purpose, Purpose), eq(OtpCodes.CodeHash, Candidate),
      isNull(OtpCodes.UsedAt), gt(OtpCodes.ExpiresAt, sql`now()`), lt(OtpCodes.Attempts, 5)))
    .returning({ Id: OtpCodes.Id })
  if (Hit) return true
  await db.update(OtpCodes)
    .set({ Attempts: sql`${OtpCodes.Attempts} + 1` })
    .where(and(eq(OtpCodes.Destination, Destination), eq(OtpCodes.Purpose, Purpose), isNull(OtpCodes.UsedAt)))
  return false
}
```

`Destination` is the E.164 phone or the lowercased email; a unique index on `(Destination, Purpose)` keeps one code row, replaced with an upsert on resend.

## Verify

- [ ] `[M]` Codes are stored as HMACs, not digits.
- [ ] `[M]` Sixth attempt fails even with the right code.
- [ ] `[M]` Resend within 60 s is refused.
- [ ] `[S]` A number outside the allowed countries gets no SMS and a generic answer.
- [ ] `[S]` TOTP code reused within the same step is rejected.
- [ ] `[A]` Admin sign-in requires 2FA.

## Pitfalls

- **`Math.random()` codes** → predictable → CSPRNG.
- **Unlimited sends** → SMS bill of thousands overnight → per-destination, IP, country and daily budgets.
- **Plain SHA-256 of a 6-digit code** → brute-forced offline in milliseconds → HMAC with a secret.

## Related

`backend/auth/sessions.md` · `backend/auth/password-reset.md` · `backend/reliability/rate-limit.md`
