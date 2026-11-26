# Health checks

- **Situation:** `/health` endpoint, uptime monitors, deploy scripts waiting for the app, load balancers, "the process is up but the site is broken".
- **Skip when:** never for a server.
- **Decision:** two endpoints. `/health` (liveness): the process can answer, touches nothing. `/ready` (readiness): critical dependencies reachable within a short timeout. Uptime checks and restarts use `/health`; deploys and load balancers use `/ready`.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Every server: `/health` |
| Standard | Production: `/ready` plus an external uptime check |
| Advanced | Several instances behind a balancer; dependency detail for operators |

## Rules

### Minimum — always, never cut

- `GET /health` returns `200 {"Status":"ok"}` with no database or network call, no auth, no logging.

### Standard — adds

- `GET /ready` checks the database (`SELECT 1`) and other **critical** dependencies (Redis if sessions live there) with a 1-second timeout each, in parallel; `503` if any fails.
- Non-critical dependencies (email provider, payment gateway) are not in readiness: their failure degrades a feature, it doesn't take the instance out.
- The deploy script waits for `/ready` on the new process before switching traffic or finishing (`quality/availability/zero-downtime-deploy.md`).
- An external uptime monitor (UptimeRobot, Better Stack, Uptime Kuma on another machine) checks the public `/health` every minute and a key page or API through the full stack.
- During graceful shutdown `/ready` returns `503` first, so traffic drains before the process exits.

### Advanced — adds

- `/ready` responses expose per-dependency status and latency only on the internal port or with an operator token; publicly just the status.
- Synthetic checks of a real user path (sign in → load dashboard) every 5 minutes from outside.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Database down | `/health` 200 (don't restart-loop the process), `/ready` 503, alert fires |
| Database slow (5 s per query) | `/ready` times out at 1 s and reports 503; the uptime monitor of a real page catches the slowness |
| Readiness checked thousands of times per minute | Results cached for 2–5 s so the check doesn't load the database |
| Health endpoint behind auth middleware | Mounted before auth, rate limit and logging middleware |
| Nginx up, app down | The external monitor hits a path that goes through Nginx to the app, so it sees the 502 |

## Example — Standard, Bun + Hono

```ts
const WithTimeout = <T>(P: Promise<T>, Ms: number) =>
  Promise.race([P, new Promise<never>((_, Reject) => setTimeout(() => Reject(new Error("timeout")), Ms))])

let IsShuttingDown = false
export const MarkShuttingDown = () => { IsShuttingDown = true }

App.get("/health", (c) => c.json({ Status: "ok" }))

App.get("/ready", async (c) => {
  if (IsShuttingDown) return c.json({ Status: "draining" }, 503)
  const Checks = await Promise.allSettled([WithTimeout(db.execute(sql`select 1`), 1000)])
  const IsReady = Checks.every((R) => R.status === "fulfilled")
  return c.json({ Status: IsReady ? "ok" : "unavailable" }, IsReady ? 200 : 503)
})
```

Both routes are registered before the auth, rate-limit and access-log middleware.

## Verify

- [ ] `[M]` `curl -s localhost:$PORT/health` returns 200 with the database stopped.
- [ ] `[S]` With the database stopped, `/ready` returns 503 within ~1 s.
- [ ] `[S]` The uptime monitor alerted on a test outage (stop the app for 2 minutes).
- [ ] `[S]` During a deploy, `/ready` goes 503 on the old process before it exits.

## Pitfalls

- **Database in liveness** → a DB blip restarts every process → DB only in readiness.
- **Health check that always returns 200** → the balancer keeps sending traffic to a broken instance → real readiness.
- **Monitor only from the same server** → it dies with the server → external monitor.

## Related

`quality/observability/alerting.md` · `quality/reliability/graceful-shutdown.md` · `quality/availability/zero-downtime-deploy.md`
