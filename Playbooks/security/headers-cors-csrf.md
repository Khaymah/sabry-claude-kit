# Security headers, CORS, CSRF, cookies

- **Situation:** "add helmet", CORS errors, "allow the frontend domain", cookie sessions, CSRF tokens, `SameSite`, CSP, clickjacking, a pentest report about missing headers.
- **Skip when:** a pure server-to-server API with no browser client and no cookies (CORS and CSRF do not apply; still set the basic headers).
- **Decision:** CORS is an explicit allowlist, never a reflected `Origin`. Cookie sessions are `HttpOnly; Secure; SameSite=Lax` plus an Origin check on every state-changing request. Bearer-token APIs need no CSRF protection but also never store the token in `localStorage` when a cookie is possible.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Any browser-facing app: basic headers, CORS allowlist, cookie flags, Origin check |
| Standard | Cookie sessions with forms or several subdomains: CSRF token, CSP in report-only then enforced, HSTS |
| Advanced | Embedded widgets, third-party scripts, payments pages: nonce-based CSP, `Cross-Origin-*` isolation, Trusted Types |

## Rules

### Minimum — always, never cut

- CORS: `Access-Control-Allow-Origin` comes from a list in config, matched by exact string. Never echo the request `Origin` back, never `*` together with credentials, never `null`.
- Cookies carrying a session: `HttpOnly; Secure; SameSite=Lax; Path=/`, with the `__Host-` prefix when no `Domain` is needed. `SameSite=None` only for a documented cross-site embed.
- State-changing methods (`POST`, `PUT`, `PATCH`, `DELETE`) never run on `GET`. A `GET` that changes data is a CSRF hole.
- On cookie-authenticated state-changing requests, reject when `Origin` (or `Sec-Fetch-Site`) is not our own origin or an allowlisted one; a missing `Origin` is allowed only when `Sec-Fetch-Site` is `same-origin` or `none`.
- API responses set `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Cache-Control: no-store` on authenticated responses.
- Pages are not framable: `Content-Security-Policy: frame-ancestors 'none'` (or `'self'`), with `X-Frame-Options: DENY` for old browsers.
- Preflight `Access-Control-Allow-Methods` and `-Headers` list only what the API uses; `Access-Control-Max-Age` is set so browsers cache it.

### Standard — adds

- HSTS: `Strict-Transport-Security: max-age=31536000; includeSubDomains` after every subdomain serves HTTPS; `preload` only when the owner decides.
- Double-submit or synchronizer CSRF token for cookie sessions that accept forms, on top of the Origin check; the token is bound to the session and compared in constant time.
- CSP ships as `Content-Security-Policy-Report-Only` first, with a report endpoint, then enforced after a clean week. Start from `default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`.
- `Permissions-Policy` disables what the app never uses (`camera=(), microphone=(), geolocation=()`).
- Next.js sets headers in `next.config.ts` `headers()` or middleware, not per page; API route handlers set their own CORS because `headers()` does not cover preflight.

### Advanced — adds

- Nonce-based CSP with `'strict-dynamic'`, no `'unsafe-inline'` for scripts; nonce generated per response.
- `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Resource-Policy: same-site` on sensitive pages.
- Subresource Integrity on any third-party script that cannot be self-hosted.

## Edge cases

| Case | Expected behaviour |
|---|---|
| `Origin: https://app.example.com.evil.com` against allowlist `app.example.com` | No match: exact comparison, never `endsWith` or `includes` |
| Request with `Origin: null` (sandboxed iframe, `file://`, redirects) | Treated as not allowed, never added to the allowlist |
| Preflight for a route that needs auth | `OPTIONS` answers without credentials and without touching the session; the real request is the one authenticated |
| Mobile app or server client sends no `Origin` | Allowed on bearer-token routes; cookie routes require same-origin evidence |
| Sibling subdomain (`blog.example.com`) can set cookies on the parent | Session cookie uses `__Host-` (no `Domain`), so a sibling cannot overwrite it |
| Old sessions issued without `SameSite` or `Secure` | On next request the server reissues the cookie with the right flags; old cookies are not trusted to be fixed by the client |
| Staging and local origins in the production allowlist | Allowlist comes from per-environment config; production holds production origins only |
| Data at 100×: thousands of tenant custom domains | Allowed origins are looked up from the `Domains` table with a short in-memory cache and an index, not a giant regex or env list |
| Twice / parallel: a form submitted twice with the same CSRF token | The token stays valid for the session (not single-use); duplicate effects are stopped by idempotency (`backend/reliability/idempotency.md`), not by the token |

## Example — Standard, Bun + Hono

```ts
const AllowedOrigins = new Set(Config.CorsOrigins)

export const SecurityHeaders = createMiddleware(async (C, Next) => {
  await Next()
  C.header("X-Content-Type-Options", "nosniff")
  C.header("Referrer-Policy", "strict-origin-when-cross-origin")
  C.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
  C.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
  if (C.req.header("Cookie")) C.header("Cache-Control", "no-store")
})

export const Cors = cors({
  origin: (Origin) => (AllowedOrigins.has(Origin) ? Origin : null),
  credentials: true,
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  allowHeaders: ["Content-Type", "Authorization"],
  maxAge: 600,
})

const Unsafe = new Set(["POST", "PUT", "PATCH", "DELETE"])

export const OriginCheck = createMiddleware(async (C, Next) => {
  if (!Unsafe.has(C.req.method) || !getCookie(C, "__Host-Session")) return Next()
  const Origin = C.req.header("Origin")
  const Site = C.req.header("Sec-Fetch-Site")
  const Ok = Origin ? AllowedOrigins.has(Origin) : Site === "same-origin" || Site === "none"
  if (!Ok) throw new AppError("CSRF_REJECTED", 403)
  return Next()
})

export const SetSession = (C: Context, Value: string) =>
  setCookie(C, "__Host-Session", Value, { httpOnly: true, secure: true, sameSite: "Lax", path: "/", maxAge: 60 * 60 * 24 * 7 })
```

Other stacks: Fastify uses `@fastify/helmet`, `@fastify/cors` (function `origin`) and `@fastify/csrf-protection`; Next.js sets headers in `next.config.ts` and CORS in the route handler.

## Verify

- [ ] `[M]` `curl -H "Origin: https://evil.com" -i $API/me` returns no `Access-Control-Allow-Origin`.
- [ ] `[M]` The session cookie in DevTools shows `HttpOnly`, `Secure`, `SameSite=Lax`.
- [ ] `[M]` A cross-origin `POST` with the session cookie and `Origin: https://evil.com` returns 403.
- [ ] `[M]` The app in an `<iframe>` on another origin is refused.
- [ ] `[S]` A CSP violation appears at the report endpoint in report-only mode before enforcement.
- [ ] `[S]` `securityheaders.com` (or equivalent) grade is A or better.
- [ ] `[A]` No inline script runs without the response's nonce.

## Pitfalls

- **`origin: (o) => o` or `cors()` with defaults plus `credentials: true`** → any site reads the user's data → the allowlist function above.
- **Regex allowlist `/example\.com$/`** → `evilexample.com` passes → exact set lookup.
- **CSRF token stored in `localStorage` and bearer auth, plus an unused cookie** → half-protection → pick one auth transport per route.
- **`SameSite=Lax` as the only defence** → `GET` mutations and subdomain attacks still work → methods rule plus Origin check.
- **Headers set only in the frontend dev server** → missing in production → set in the code that serves production.

## Related

`backend/auth/sessions.md` · `backend/reliability/idempotency.md` · `security/injection.md` §XSS · `Stacks/` (framework headers)
