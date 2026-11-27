# Injection: SQL, XSS, SSRF, paths, commands

- **Situation:** raw SQL, `sql.raw`, sorting or filtering by a user-supplied column, rendering user HTML or markdown, "fetch this URL" or webhook-URL features, link previews, file paths from user input, shelling out, a pentest finding about injection.
- **Skip when:** nothing user-controlled reaches a query, a page, a URL fetch, a path or a process (rare). File content checks: `backend/files/uploads.md`.
- **Decision:** user input is always data, never code: parameters for SQL, allowlists for anything structural (column, direction, path, command), escaping by the framework for HTML, and a resolve-then-validate fetch for any URL we call.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Any app with a database or UI: parameters, allowlists, no raw HTML |
| Standard | Rich text or markdown, webhook URLs, URL import, file paths, exports |
| Advanced | Fetching arbitrary customer URLs at scale, user-supplied templates or code, multi-tenant on shared infrastructure |

## Rules

### Minimum — always, never cut

- Drizzle query builder or `sql` template for everything; interpolated values inside `sql\`\`` become placeholders. `sql.raw()` and string concatenation never receive user input.
- `ORDER BY`, column names and sort direction come from an allowlist map (`{ CreatedAt: Orders.CreatedAt }`), never from `sql.raw(Query.sort)` or a template string.
- `LIKE` input escapes `%`, `_` and `\` so a user cannot turn a search into a full scan.
- Never `dangerouslySetInnerHTML`, `innerHTML`, `v-html` or `{@html}` with user content unless it went through a sanitiser (DOMPurify with a tag allowlist) in the same function.
- Markdown from users renders with raw HTML disabled, or output goes through the sanitiser; links get `rel="noopener noreferrer nofollow"` and only `http`, `https`, `mailto` schemes (`javascript:` and `data:` are rejected).
- JSON embedded in a page escapes `<` as `\u003c`; user data never lands in `<script>`, inline event handlers or `style` attributes.
- Files are never opened by a user-supplied path: take an id, look up the stored key, and build the path from that. If a name must be used, `basename` plus a check that the resolved path starts with the base directory.
- No `exec`, `child_process.exec` or `Bun.$` with user text in a shell string; use `spawn` with an argument array and an allowlist of commands. Never `eval`, `new Function` or `vm` on user input.

### Standard — adds

- Any feature that fetches a user-supplied URL (webhook target, image import, link preview, RSS, OAuth metadata) goes through one `SafeFetch`: `https` only (and `http` only if the owner says), resolve DNS first, reject private, loopback, link-local and metadata ranges (`10/8`, `172.16/12`, `192.168/16`, `127/8`, `169.254/16`, `100.64/10`, `0.0.0.0`, `::1`, `fc00::/7`, `fe80::/10`, and IPv4-mapped IPv6), then connect to the resolved IP.
- Redirects are followed manually, at most 3, each hop re-validated; response size and time are capped (`backend/reliability/outbound-calls.md`).
- Cloud metadata (`169.254.169.254`) is blocked at the network layer too; app checks alone are not the only wall.
- Egress from the app to the internal network is denied by firewall unless a service needs it.
- Stored user HTML (descriptions, comments) is sanitised on write and again on render when the sanitiser version changes.
- Escape per context: HTML body, attribute, URL, CSS and JS are different; use the framework's binding, not hand-made `replace`.

### Advanced — adds

- Fetches run in a separate worker or network segment with no route to internal services or the database.
- User-supplied templates run in a sandbox (no `constructor` access, no file or network), or are replaced by a fixed placeholder syntax.
- Trusted Types and a strict CSP (`security/headers-cors-csrf.md`) as the second layer against XSS.

## Edge cases

| Case | Expected behaviour |
|---|---|
| `sort=CreatedAt;DROP TABLE x` or `sort=Password` (a real column the user must not sort by) | Not in the allowlist: 400 with the allowed values; a valid-looking but forbidden column is rejected the same way |
| URL `http://evil.com@127.0.0.1/` or `http://2130706433/` or `http://0x7f.1/` | Parsed with the `URL` class, hostname resolved, the resulting IP checked; never string-matched on the hostname |
| DNS rebinding: first lookup is public, the connection resolves to `127.0.0.1` | Connect to the validated IP itself (pin it, send the original `Host`/SNI); never resolve twice |
| Public URL redirects to `http://169.254.169.254/` | Each redirect hop is re-resolved and re-validated; blocked at the hop |
| `file:`, `gopher:`, `ftp:` or `javascript:` schemes | Rejected by the scheme allowlist before any fetch or render |
| Filename `../../etc/passwd`, `..%2f`, `C:\x`, or a null byte | Never used as a path; resolved path outside the base directory is a 400 |
| Markdown image `![](https://tracker/x.png)` in a comment | Allowed only if the owner accepts remote images; otherwise proxied or stripped (it leaks the reader's IP) |
| Old rows saved before sanitising existed | Sanitised at render time as well as on write, so legacy rows cannot execute |
| Data at 100×: a "fetch my feed" feature with 100k URLs | Fetches are queued with per-host concurrency and per-tenant limits; one slow or huge target cannot fill the workers |
| Twice / parallel: the same URL submitted twice | Validation is stateless and runs on every call; the duplicate effect is stopped by a unique constraint or idempotency key, not by "we already checked it" |

## Example — Standard, Bun + Hono + Drizzle

```ts
const SortColumns = {
  CreatedAt: Orders.CreatedAt,
  TotalMinor: Orders.TotalMinor,
  Status: Orders.Status,
} as const

export function OrderBy(Sort: string, Dir: string) {
  const Column = SortColumns[Sort as keyof typeof SortColumns]
  if (!Column) throw new AppError("QUERY_SORT_INVALID", 400)
  return Dir === "asc" ? asc(Column) : desc(Column)
}

export const EscapeLike = (Value: string) => Value.replace(/[\\%_]/g, (C) => `\\${C}`)

export const SearchOrders = (TenantId: string, Term: string) =>
  Db.select().from(Orders).where(and(eq(Orders.TenantId, TenantId), ilike(Orders.Reference, `%${EscapeLike(Term)}%`)))

const Blocked = new BlockList()
for (const [Net, Prefix] of [["10.0.0.0", 8], ["172.16.0.0", 12], ["192.168.0.0", 16], ["127.0.0.0", 8], ["169.254.0.0", 16], ["100.64.0.0", 10], ["0.0.0.0", 8]] as const) Blocked.addSubnet(Net, Prefix, "ipv4")
Blocked.addSubnet("::1", 128, "ipv6")
Blocked.addSubnet("fc00::", 7, "ipv6")
Blocked.addSubnet("fe80::", 10, "ipv6")

async function Resolve(Hostname: string) {
  const Records = await dns.lookup(Hostname, { all: true })
  if (Records.length === 0) throw new AppError("FETCH_DNS_FAILED", 400)
  for (const R of Records) {
    const Mapped = R.address.startsWith("::ffff:") ? R.address.slice(7) : R.address
    if (Blocked.check(Mapped, Mapped.includes(":") ? "ipv6" : "ipv4")) throw new AppError("FETCH_TARGET_FORBIDDEN", 400)
  }
  return Records[0]
}

export async function SafeFetch(Input: string, Hops = 0): Promise<Response> {
  const Url = new URL(Input)
  if (Url.protocol !== "https:" || Hops > 3) throw new AppError("FETCH_URL_INVALID", 400)
  const Target = await Resolve(Url.hostname)
  const Pinned = new URL(Url)
  Pinned.hostname = Target.family === 6 ? `[${Target.address}]` : Target.address
  const Res = await fetch(Pinned, { redirect: "manual", headers: { Host: Url.host }, signal: AbortSignal.timeout(5000), tls: { serverName: Url.hostname } })
  const Next = Res.headers.get("Location")
  return Res.status >= 300 && Res.status < 400 && Next ? SafeFetch(new URL(Next, Url).toString(), Hops + 1) : Res
}
```

Other stacks: `ssrf-req-filter` or `Dagger`-style egress proxies (Smokescreen) do the same at the network layer; Next.js server actions and route handlers use the same `SafeFetch`. Pinning the IP while keeping SNI depends on the runtime's `fetch`; if it cannot, run the fetch through an egress proxy that does.

## Verify

- [ ] `[M]` `?sort=Password` and `?sort=CreatedAt;--` both return 400.
- [ ] `[M]` Searching for `%` or `_` matches only literal `%` and `_`.
- [ ] `[M]` Saving `<img src=x onerror=alert(1)>` as a comment and viewing it runs no script.
- [ ] `[M]` `grep -rn "sql.raw\|dangerouslySetInnerHTML\|child_process\|\.exec(" src/` lists only reviewed uses with no user input.
- [ ] `[S]` `SafeFetch` rejects `http://127.0.0.1`, `http://[::1]`, `http://169.254.169.254`, `http://2130706433`, and a public URL redirecting to them.
- [ ] `[S]` A stub DNS that answers public then private is blocked (rebinding test).
- [ ] `[A]` The fetch worker cannot reach the database host from its network.

## Pitfalls

- **`sql.raw(\`ORDER BY ${Sort}\`)`** → full SQL injection through a sort parameter → allowlist map.
- **Blocking by hostname string (`localhost`, `127.0.0.1`)** → decimal, hex, IPv6 and DNS names bypass it → resolve then check the IP.
- **Validating the URL, then fetching it (second lookup)** → rebinding window → connect to the validated address.
- **Sanitising markdown source, then rendering** → the renderer re-introduces HTML → sanitise the final HTML.
- **`path.join(Base, UserName)`** → `..` escapes the base → resolve and compare prefix, or use ids.

## Related

`backend/files/uploads.md` · `backend/files/import-export.md` · `backend/reliability/outbound-calls.md` · `security/headers-cors-csrf.md` · `Stacks/Database.md`
