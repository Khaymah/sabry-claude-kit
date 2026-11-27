# Secrets in code, env and logs

- **Situation:** API keys, DB passwords, JWT signing keys, webhook secrets, `.env` files, "a key was pushed to GitHub", rotating a key, secrets showing up in logs, where to keep runtime settings.
- **Skip when:** the app holds no credentials of its own (a static site with no server). Keys we issue to our customers: `backend/auth/api-keys.md`.
- **Decision:** secrets live in the environment or a secret store, are validated at boot, are never logged, and every secret can be rotated without downtime because two values are valid during the switch. A `SystemSettings` table holds runtime configuration only (feature flags, limits, labels), never a secret.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Any project with a server: env vars, `.env` ignored, boot validation, log redaction |
| Standard | Production with a team or CI: scanning in CI and pre-commit, two-key rotation, separate secrets per environment |
| Advanced | Regulated data, many services, contractors: a secret manager with audit, short-lived credentials, scheduled rotation |

## Rules

### Minimum — always, never cut

- `.env*` is in `.gitignore` before the first commit; only `.env.example` with fake placeholder values is committed.
- Secrets are read once at boot into a validated config object (zod); a missing or too-short secret stops the process with a clear name, never a silent fallback like `"secret"` or `"changeme"`.
- Never log a secret, token, `Authorization` header, cookie, password or full card/ID number. The logger redacts by key path (`authorization`, `cookie`, `password`, `token`, `secret`, `apiKey`), not by hoping nobody logs the object.
- Error responses and error trackers never include env values, connection strings or request headers.
- No secret in the client bundle: `NEXT_PUBLIC_*` and `VITE_*` are public by definition; a key there is published.
- Separate values per environment. The production key never exists on a laptop or in the staging database.
- A secret never travels in a URL query string (it lands in access logs and `Referer`); use a header.

### Standard — adds

- A secret scanner (gitleaks or similar) runs in CI on every push and as a pre-commit hook; a hit fails the build.
- Every secret has an owner, a purpose and a rotation procedure written in the project's runbook.
- Rotation is two-valid-keys: the verifier accepts `Current` and `Previous`, new signatures use `Current`, `Previous` is removed after the longest lifetime of anything signed with it.
- Rotate immediately on: a leaving team member who had access, a suspected leak, a laptop theft. Otherwise on a schedule the owner picks (default: yearly for signing keys).
- `SystemSettings (Key, Value, UpdatedBy, UpdatedAt)` for runtime config the owner edits from an admin screen; writes go to the audit log (`backend/data/audit-log.md`). A key whose name ends in `Secret`, `Key`, `Token` or `Password` is rejected by the setter.

### Advanced — adds

- Secrets come from a manager (cloud secret store, Vault, Doppler) and are injected at deploy; nothing sensitive sits in the repository, the image or CI logs.
- Database and provider credentials are short-lived or per-service with least privilege (read-only role for reports, no `DROP` for the app role).
- Reads of production secrets are audited and alert on access from an unexpected identity.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Secret committed, then "removed" in the next commit | Still in history and in every clone: treat as leaked and rotate; rewriting history is cleanup, not remediation |
| Secret shows up in a stack trace or a logged request body | Redaction covers nested paths and arrays; the field is masked as `"[REDACTED]"`, never dropped silently so debugging stays honest |
| Old rows or old tokens signed with the previous key | Verified against `Previous` until they expire; no mass logout on rotation |
| Rotation deployed to half the instances | Both keys are accepted by every instance before any instance signs with the new one (deploy order: add verifier, then switch signer) |
| Webhook secret changed at the provider before we deploy | Verify against both; the provider's retry window covers the gap |
| `.env` copied into a Docker image layer | Counts as leaked once the image is pushed; build with runtime env, `.dockerignore` lists `.env*` |
| Value is 32 chars of the same letter or the example value | Boot validation rejects known placeholders and secrets below the minimum entropy length |
| Data at 100×: logs grow 100× | Redaction is a fixed-cost path-based serializer, not regexes over every message; log volume is capped by level, not by trusting nobody logs secrets |
| Twice / parallel: two admins edit the same `SystemSettings` row, or two deploys rotate at once | `Version` check on the setting (`backend/data/concurrency.md`); rotation steps are idempotent: re-running "add verifier" changes nothing |

## Example — Standard, Bun + Hono + Drizzle

```ts
const EnvSchema = z.object({
  DatabaseUrl: z.string().url(),
  JwtSecret: z.string().min(32),
  JwtSecretPrevious: z.string().min(32).optional(),
  PaymobHmacSecret: z.string().min(16),
})

export const Config = EnvSchema.parse({
  DatabaseUrl: Bun.env.DATABASE_URL,
  JwtSecret: Bun.env.JWT_SECRET,
  JwtSecretPrevious: Bun.env.JWT_SECRET_PREVIOUS,
  PaymobHmacSecret: Bun.env.PAYMOB_HMAC_SECRET,
})

export const Logger = pino({
  redact: {
    paths: [
      "req.headers.authorization", "req.headers.cookie",
      "password", "token", "secret", "apiKey",
      "*.password", "*.token", "*.secret", "*.apiKey",
      "*.*.password", "*.*.token", "*.*.secret", "*.*.apiKey",
    ],
    censor: "[REDACTED]",
  },
})

export async function VerifyJwt(Token: string) {
  const Keys = [Config.JwtSecret, Config.JwtSecretPrevious].filter((K): K is string => Boolean(K))
  for (const Key of Keys) {
    try {
      return await jwtVerify(Token, new TextEncoder().encode(Key))
    } catch {}
  }
  throw new AppError("AUTH_INVALID_TOKEN", 401)
}

export const SystemSettings = pgTable("SystemSettings", {
  Key: text("Key").primaryKey(),
  Value: jsonb("Value").notNull(),
  Version: integer("Version").notNull().default(1),
  UpdatedBy: uuid("UpdatedBy").notNull(),
  UpdatedAt: timestamp("UpdatedAt", { withTimezone: true }).notNull().defaultNow(),
})
```

A pino `*` wildcard covers one level only, so the list spells out two levels; deeper or array-nested secrets need an explicit path (`Body.Items[*].token`) or a serializer that scrubs the object before logging. Other stacks: Next.js reads server env only in server code and Route Handlers; a variable is public only with the `NEXT_PUBLIC_` prefix. Fastify and Express use `pino` with the same `redact` option.

## Verify

- [ ] `[M]` `git ls-files | grep -E "^\.env($|\.)" | grep -v example` prints nothing.
- [ ] `[M]` Starting the app without `JWT_SECRET` exits with an error naming it; with `"changeme"` it also exits.
- [ ] `[M]` A request with `Authorization: Bearer abc` produces a log line containing `[REDACTED]` and not `abc`.
- [ ] `[M]` `grep -rn "NEXT_PUBLIC_.*\(SECRET\|KEY\|TOKEN\)"` finds only genuinely public keys (map or analytics ids).
- [ ] `[S]` Seeding a fake AWS-style key in a branch fails the CI scan.
- [ ] `[S]` A token signed with `Previous` verifies; after `Previous` is removed it returns 401.
- [ ] `[A]` Production secrets are absent from the repository, the image and CI logs.

## Pitfalls

- **`Config.JwtSecret ?? "dev-secret"`** → production runs on a public default → no fallbacks, fail at boot.
- **Logging the whole request or `error.config`** → axios errors carry the `Authorization` header → log chosen fields only.
- **Putting API keys in `SystemSettings` "so the admin can change them"** → anyone with admin or SQL read gets them, backups carry them → env or a secret store.
- **Rotating by replacing the one key** → every live token and in-flight webhook fails → two-valid-keys.
- **`catch {}` swallowing every verify error** → hides real failures; the example only swallows per-key verification, then throws one 401.

## Related

`backend/auth/api-keys.md` · `backend/auth/sessions.md` · `backend/data/audit-log.md` · `backend/data/concurrency.md` · `security/headers-cors-csrf.md`
