# Auth UI

- **Situation:** login and sign-up screens, protected pages, token refresh, logout, session expiry, "hide this button for staff", multiple tabs.
- **Skip when:** the app has no accounts, or auth is fully delegated to a hosted provider page and a library that already guards routes (then only the role-UI rule below still applies).
- **Decision:** the server is the only authority. Routes are protected in middleware plus a server-side check at the data boundary; client checks are for experience only. Role-based UI hiding is cosmetic: the API enforces every permission. Tokens live in httpOnly cookies. The backend session design (`backend/auth/sessions.md`) and the project's auth library win over the defaults below.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Login, protected routes, logout |
| Standard | Refresh handling, cross-tab logout, role-aware UI, safe redirects |
| Advanced | Step-up auth, idle timeout, device list, impersonation banner |

## Rules

### Minimum — always, never cut

- Never protect a page only in the client (`useEffect` redirect, hidden component). The page's data must be refused by the server for an anonymous or unauthorised caller.
- Protect twice: `middleware.ts` redirects unauthenticated requests to `/login?Next=…` (cheap cookie presence check, no heavy work), and every server component, route handler and server action re-verifies the session and permission before reading data. Middleware alone is not enough (matcher gaps, direct action calls).
- Tokens only in `httpOnly`, `Secure`, `SameSite=Lax` (or `Strict`) cookies. Never in `localStorage`, `sessionStorage`, URLs or logs.
- The login form never reveals whether the email exists; the message is the same for wrong email and wrong password. Generic error copy, server decides the details (`backend/auth/sessions.md`).
- Logout calls the server to revoke the session, then clears client state (`QueryClient.clear()`) and redirects. A cleared cookie alone is not a logout.

### Standard — adds

- `Next` redirect target accepts only same-origin relative paths starting with a single `/`; reject `//evil.com`, `https:`, `javascript:`, backslashes. Validate on read, not only on write.
- Refresh: one in-flight refresh shared by all parallel requests (a single promise); the others wait and retry once. A refresh failure triggers one redirect to login, preserving `Next`, and clears the cache. Never loop retry on 401.
- Refresh happens in the server layer or a route handler that sets the cookies; the browser never sees a refresh token.
- Cross-tab logout and login: broadcast with `BroadcastChannel("auth")` (fallback `storage` event). On logout in one tab all tabs clear the cache and go to login; on company switch the other tabs reload (`data-fetching.md`).
- Role-based UI: gate with a `Can(Permission)` helper fed by the server's permission list for this session, to hide buttons and routes for convenience. The same permissions are enforced by the API (`backend/auth/rbac.md`). A hidden button is never the control.
- Session expiry during a long form: the failed submit keeps the user's input, re-authenticates in a dialog or redirect with draft, then retries with the same idempotency key (`optimistic-ui.md`).
- Login rate-limit and lockout messages come from the API as codes and are shown in plain words with the wait time. Disable the form while a request is pending.
- Do not render the app shell flash of an authenticated layout before the session is known: decide on the server.

### Advanced — adds

- Step-up auth (re-enter password or OTP) before sensitive actions, enforced by the API, prompted by the UI on a `403 STEP_UP_REQUIRED` code.
- Idle timeout warning with a countdown dialog (`role="alertdialog"`) and a keep-alive call; the server enforces the real timeout.
- Impersonation: a persistent, non-dismissible banner with an exit button, shown whenever the session is impersonated (`backend/auth/impersonation.md`).

## Edge cases

| Case | Expected behaviour |
|---|---|
| User opens `/admin/users` anonymously | Middleware redirects to `/login?Next=%2Fadmin%2Fusers`; no data is sent |
| User with a cookie but without the role opens the page directly | Server check returns 403 and the page shows a no-access state, not a redirect loop |
| Hidden "Delete" button, user calls the API with curl | API refuses (403); hiding was only cosmetic |
| Access token expires while five queries are in flight | One refresh; all five retry once; user sees nothing |
| Refresh token revoked (password changed elsewhere) | One redirect to login with a message "signed out", cache cleared |
| Logout in tab A | Tab B shows the login screen within a second; no cached data remains |
| `Next=//evil.com` | Ignored; user lands on the default home |
| Data at 100×: 100 parallel requests at expiry | Still exactly one refresh call |
| Twice / parallel: login submitted twice | One request; second ignored while pending; the server issues one session |
| Back button after logout | Protected pages are not served from bfcache: `Cache-Control: no-store` on authenticated HTML and a server re-check |
| Company switch changes the permission set | Permissions refetched and the UI re-evaluated before the next render |

## Example — Standard, Next.js

```ts
export function middleware(Request: NextRequest) {
  const Session = Request.cookies.get("Session")?.value
  if (!Session && !PublicPaths.some((P) => Request.nextUrl.pathname.startsWith(P))) {
    const Url = new URL("/login", Request.url)
    Url.searchParams.set("Next", Request.nextUrl.pathname + Request.nextUrl.search)
    return NextResponse.redirect(Url)
  }
  return NextResponse.next()
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|api/public).*)"] }

export async function RequireUser(Permission?: string) {
  const Session = await GetSession()
  if (!Session) redirect("/login")
  if (Permission && !Session.Permissions.includes(Permission)) forbidden()
  return Session
}

export const SafeNext = (Value: string | null) => (Value && /^\/(?![/\\])/.test(Value) ? Value : "/")

let RefreshPromise: Promise<boolean> | null = null
export function RefreshOnce() {
  RefreshPromise ??= fetch("/api/auth/refresh", { method: "POST" }).then((R) => R.ok).finally(() => { RefreshPromise = null })
  return RefreshPromise
}

export function Can({ Permission, Children }: { Permission: string; Children: React.ReactNode }) {
  const Permissions = usePermissions()
  return Permissions.has(Permission) ? <>{Children}</> : null
}
```

`RequireUser` is called at the top of every protected page, route handler and server action. Other stacks: Auth.js, Clerk and Supabase provide the session helper; the double check and the cosmetic role rule do not change.

## Verify

- [ ] `[M]` `curl` a protected page and its data endpoint with no cookie: redirect and 401, no data in the body.
- [ ] `[M]` Logout, then press Back: the protected page does not show data.
- [ ] `[S]` With a staff cookie, call an admin API directly: 403 even though the button is hidden.
- [ ] `[S]` Expire the access token with five parallel queries: one refresh request in the network tab.
- [ ] `[S]` Log out in one tab: the other tab reaches login and holds no cache.
- [ ] `[S]` `?Next=//evil.com` and `?Next=https://evil.com` land on the home page.
- [ ] `[A]` A sensitive action without recent re-auth returns `STEP_UP_REQUIRED` and the dialog opens.

## Pitfalls

- **Client-only guard** → page source or API still leaks data → middleware plus server check.
- **Token in `localStorage`** → any XSS steals the session → httpOnly cookie.
- **Each request refreshes on its own 401** → refresh storm, token reuse alarms → single shared promise.
- **Trusting the `Next` param** → open redirect for phishing → same-origin path only.
- **Role flags in a JWT trusted by the UI for access** → stale after a role change → server permission check per request.

## Related

`frontend/data-fetching.md` · `frontend/forms.md` · `frontend/four-states.md` · `backend/auth/sessions.md` · `backend/auth/rbac.md` · `backend/auth/impersonation.md` · `backend/reliability/idempotency.md`
