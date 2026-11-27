# Rate limiting

- **Situation:** brute force on sign-in, OTP and reset abuse, scraping, API quotas per customer, expensive endpoints (AI, exports, search), "someone is hammering the API".
- **Skip when:** an internal tool on a private network.
- **Decision:** two layers. Nginx `limit_req` per IP as a cheap outer wall; application limits per identity (user, API key, email, phone) and per route class, stored in Redis when there is more than one instance. Over the limit: `429` with `Retry-After` and `RateLimit-*` headers.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Nginx limits on auth routes; in-memory app limits on one instance |
| Standard | Production: Redis-backed per-identity limits on auth, OTP, writes and expensive routes |
| Advanced | Public API: per-key quotas and plans, burst + sustained limits, dashboards |

## Rules

### Minimum — always, never cut

- Nginx: a `limit_req_zone` per IP for `/api/v1/auth/` (e.g. 10/min, burst 5) and a general one for the API (e.g. 20/s, burst 40).
- The real client IP comes from Nginx (`X-Real-IP` / `X-Forwarded-For` set by Nginx); the app trusts it only from the proxy address, never from the client directly.
- Sign-in, OTP send, password reset request and sign-up are limited per IP **and** per target (email or phone), so a botnet can't hammer one account and one IP can't spray many.

### Standard — adds

- Redis-backed counters (fixed window with `INCR` + `EXPIRE`, or sliding window) so limits hold across instances and restarts.
- Limits per route class in `SystemSettings` (`RateLimit.Auth`, `RateLimit.Write`, `RateLimit.Expensive`), tunable without a deploy.
- Responses: `429 RATE_LIMITED` with `Retry-After` and `RateLimit-Limit` / `RateLimit-Remaining` / `RateLimit-Reset` headers.
- Authenticated users are limited by user id (not IP, which offices and mobile carriers share).
- Expensive endpoints (AI generation, exports) have per-user concurrency limits too, not only per-minute counts.

### Advanced — adds

- Per-API-key quotas by plan (daily and per-second), metered for billing.
- Token bucket for burst + sustained rates.
- Dashboards of top limited identities; automatic temporary blocks for clear abuse patterns.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Many users behind one office or carrier IP | IP limits are generous; per-user limits do the real work once signed in |
| Redis down | Fail open for normal routes (log + alert), fail closed for auth and OTP routes (use the in-memory fallback limiter) |
| Attacker rotates IPs against one account | Per-email / per-phone limit stops it; account-level backoff (`backend/auth/sessions.md`) |
| Legitimate burst (page loads 15 API calls) | Burst allowance in Nginx; per-route limits only on sensitive routes |
| Webhooks from providers | Exempt from user limits; own bulkhead (`quality/reliability/backpressure.md`) |
| 100×: traffic 100× (launch day) | Limits reviewed before launch; Nginx keeps the app from overload |
| Twice / parallel: parallel requests racing the counter | `INCR` is atomic; the count is exact across instances |

## Example — Standard, Bun + Hono + Redis

```ts
export const RateLimit = (Name: string, KeyOf: (c: Context<AppEnv>) => string) => createMiddleware<AppEnv>(async (c, Next) => {
  const { Limit, WindowSeconds } = GetSetting(`RateLimit.${Name}`)
  const Window = Math.floor(Date.now() / 1000 / WindowSeconds)
  const Key = `rl:${Name}:${KeyOf(c)}:${Window}`
  const Result = await Redis.multi().incr(Key).expire(Key, WindowSeconds, "NX").exec()
  const Count = Number(Result?.[0]?.[1] ?? 0)
  const Reset = (Window + 1) * WindowSeconds - Math.floor(Date.now() / 1000)
  c.header("RateLimit-Limit", String(Limit))
  c.header("RateLimit-Remaining", String(Math.max(0, Limit - Count)))
  c.header("RateLimit-Reset", String(Reset))
  if (Count > Limit) {
    c.header("Retry-After", String(Reset))
    throw new AppError("RATE_LIMITED", 429)
  }
  await Next()
})

AuthRoutes.post("/sign-in",
  RateLimit("SignInIp", (c) => c.get("ClientIp")),
  zValidator("json", SignInBody),
  RateLimit("SignInEmail", (c) => c.req.valid("json").Email.toLowerCase()),
  AuthController.SignIn)
```

```nginx
limit_req_zone $binary_remote_addr zone=auth:10m rate=10r/m;
limit_req_zone $binary_remote_addr zone=api:20m rate=20r/s;
location /api/v1/auth/ { limit_req zone=auth burst=5 nodelay; limit_req_status 429; proxy_pass http://api; }
location /api/ { limit_req zone=api burst=40 nodelay; limit_req_status 429; proxy_pass http://api; }
```

`INCR` and `EXPIRE … NX` run in one `MULTI`, so a crash between them can't leave a counter without an expiry (Redis 7+). Single instance without Redis: the same middleware over an `LRUCache` counter, marked `// shortcut: in-memory rate limit, move to Redis at 2 instances`.

## Verify

- [ ] `[M]` 11 sign-in attempts in a minute from one IP: the 11th gets 429.
- [ ] `[M]` `X-Forwarded-For` sent directly by a client (bypassing Nginx) does not change the limiter's IP.
- [ ] `[S]` Attempts on one email from 10 IPs are limited per email.
- [ ] `[S]` Limits hold across two instances.
- [ ] `[S]` 429 responses carry `Retry-After`.
- [ ] `[A]` API-key quota resets on schedule and is visible to the customer.

## Pitfalls

- **Per-IP only** → one account brute-forced from many IPs, or a whole office blocked → per-identity too.
- **In-memory limits with several instances** → limits multiplied by instance count → Redis.
- **Trusting `X-Forwarded-For` from anyone** → trivial bypass → trust only the proxy.

## Related

`backend/auth/sessions.md` · `backend/auth/otp.md` · `quality/reliability/backpressure.md` · `backend/auth/api-keys.md`
