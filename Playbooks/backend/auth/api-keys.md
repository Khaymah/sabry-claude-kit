# API keys

- **Situation:** customers or partners calling our API from their servers, integrations (Zapier, ERP), webhooks signing secrets, machine-to-machine access, "give the client a key".
- **Skip when:** the caller is a browser or a mobile app: those use user sessions, never embedded keys.
- **Decision:** keys look like `sk_live_<32 random bytes base62>`; shown once at creation; stored as a SHA-256 hash plus a short visible prefix; scoped to permissions and to one tenant; sent as `Authorization: Bearer`; revocable, rotatable with overlap, rate-limited per key.

## Levels

| Level | Pick when |
|---|---|
| Minimum | One internal integration: hashed key, revocable |
| Standard | Customers create their own keys: scopes, last-used, rotation, per-key limits |
| Advanced | Public API product: usage metering, IP allow-lists, request signing |

## Rules

### Minimum — always, never cut

- Key = environment prefix (`sk_live_` / `sk_test_`) + 32 random bytes (base62). The prefix makes leaks detectable by secret scanners.
- Store `SHA-256(key)` and the first 12 characters (`KeyPrefix`) for display; never the key. A fast hash is right: the key has 256 bits of entropy.
- Shown once in the creation response with a "copy now" warning; never retrievable later.
- Lookup by hash with a unique index; constant-time behaviour is given by the hash lookup (no string comparison of secrets in JS).
- Revoked or expired keys return `401` like any invalid key.

### Standard — adds

- `ApiKeys`: `TenantId`, `Name`, `KeyPrefix`, `KeyHash`, `Scopes text[]`, `CreatedBy`, `LastUsedAt`, `ExpiresAt`, `RevokedAt`.
- Scopes map to the same permission strings as users (`backend/auth/rbac.md`); a key can't hold scopes its creator lacks.
- Rotation: create a new key, both work until the old one is revoked (or auto-expires after the overlap period).
- `LastUsedAt` updated at most once per minute per key (batched), not on every request.
- Rate limit per key (`backend/reliability/rate-limit.md`), with `X-RateLimit-*` headers.
- Creation, rotation and revocation are audit-logged.

### Advanced — adds

- Usage metering per key and endpoint for billing and quotas.
- Optional IP allow-list per key.
- Request signing (HMAC of method, path, timestamp, body hash) for high-value APIs, rejecting timestamps older than 5 minutes.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Key pasted into a public GitHub repo | The `sk_live_` prefix is registered with GitHub secret scanning where possible; a leak report revokes the key and emails the owner |
| Key sent in a query string | Rejected (`401`) so keys don't land in logs and proxies |
| Creator of the key leaves the company | The key belongs to the tenant, survives, and shows "created by a former member" |
| Test key used against live data | Test keys only see test-mode data, enforced in the query scope |
| Key without an expiry | Allowed at Standard; Advanced tenants can force max lifetimes |
| 100×: 10,000 requests per second on one key | Hash lookup cached in an LRU for 60 s; `LastUsedAt` batched; rate limiter in Redis |
| Twice / parallel: key revoked while requests are in flight | Requests started before revocation finish; new ones fail within the cache TTL (≤ 60 s), or at once if revocation also evicts the cache via `NOTIFY` |

## Example — Standard, Bun + Hono

```ts
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

export function GenerateApiKey(Mode: "live" | "test") {
  const Bytes = crypto.getRandomValues(new Uint8Array(32))
  const Body = Array.from(Bytes, (B) => BASE62[B % 62]).join("")
  return `sk_${Mode}_${Body}`
}

export const ApiKeyAuth = createMiddleware<AppEnv>(async (c, Next) => {
  const Header = c.req.header("Authorization") ?? ""
  const Key = Header.startsWith("Bearer sk_") ? Header.slice(7) : null
  if (!Key) throw new AppError("AUTH_REQUIRED", 401)
  const Hash = await Sha256Hex(Key)
  const Row = await ApiKeyCache.fetch(Hash)
  if (!Row || Row.RevokedAt || (Row.ExpiresAt && Row.ExpiresAt < new Date())) throw new AppError("AUTH_INVALID", 401)
  c.set("Principal", { Type: "ApiKey", Id: Row.Id, TenantId: Row.TenantId, Scopes: new Set(Row.Scopes) })
  MarkKeyUsed(Row.Id)
  await Next()
})
```

`B % 62` over 256 values has a slight bias (256 is not a multiple of 62); it costs a fraction of a bit of entropy out of ~190, acceptable for keys. `ApiKeyCache` is an `LRUCache` with `fetchMethod` loading by hash and a 60 s TTL; `MarkKeyUsed` adds the id to a set flushed every minute in one `UPDATE … WHERE "Id" = ANY($1)`.

## Verify

- [ ] `[M]` The database holds no plaintext key; creation response is the only place it appears.
- [ ] `[M]` Revoked key → 401.
- [ ] `[S]` A key with `Orders.View` gets 403 on `Orders.Refund`.
- [ ] `[S]` During rotation, both keys work; after revoking the old, only the new.
- [ ] `[S]` 1,000 requests produce at most a handful of `LastUsedAt` writes.
- [ ] `[A]` A signed request older than 5 minutes is rejected.

## Pitfalls

- **Storing keys encrypted "so we can show them again"** → a database leak leaks every key → hash, show once.
- **Keys in front-end code** → public to everyone → sessions for browsers and apps.
- **Updating `LastUsedAt` per request** → a write on every read → batch.

## Related

`backend/auth/rbac.md` · `backend/reliability/rate-limit.md` · `backend/data/multi-tenancy.md` · `backend/api/versioning.md`
