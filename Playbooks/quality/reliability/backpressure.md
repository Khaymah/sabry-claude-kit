# Backpressure and overload

- **Situation:** traffic spikes, a flash sale, a marketing push, queues growing faster than workers drain them, the database pool waiting, "everything got slow, then everything failed".
- **Skip when:** an internal tool with a known handful of users.
- **Decision:** every place work can pile up has a bound (body size, pool, queue, concurrency); when a bound is reached we reject or delay early and cheaply (429 / 503 with `Retry-After`, queued jobs) instead of accepting work we cannot finish.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Every server: bounded input and pools |
| Standard | Production: rate limits, bounded worker concurrency, queue depth visible |
| Advanced | Spiky traffic, SLAs: load shedding, priority, bulkheads |

## Rules

### Minimum — always, never cut

- Bounded inputs: body size, array lengths, page sizes (`quality/performance/memory.md`, `quality/performance/event-loop-cpu.md`).
- One database pool per process with a fixed size and an acquire timeout; a request that can't get a connection in time fails, it doesn't wait forever.
- No unbounded in-process queues (arrays used as queues, `Promise.all` over user-sized lists).

### Standard — adds

- Rate limits per IP and per user on public and expensive endpoints (`backend/reliability/rate-limit.md`), returning `429` with `Retry-After`.
- Background workers have a fixed concurrency per queue; queue depth and oldest-job age are visible and alert when they keep growing.
- Expensive work requested in bursts (exports, reports, AI calls) is queued with a per-user limit on jobs in flight.
- Nginx limits: `limit_req` on auth and public write routes, `limit_conn` per IP, upstream `max_fails` / timeouts.

### Advanced — adds

- Load shedding: when event-loop lag, pool waiters or in-flight requests pass a threshold, new low-priority requests get `503` with `Retry-After` before doing any work; health, auth and payment callbacks are never shed.
- Bulkheads: separate pools or concurrency limits per dependency and per route class (public vs admin vs webhooks).
- Queue prioritisation: payment webhooks and user-facing jobs before bulk jobs.
- Capacity test: find the request rate where p95 doubles, keep production below 50% of it.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Flash sale: 50× normal traffic for 10 minutes | Static pages cached at Nginx; purchase requests bounded by the pool; excess gets a fast 503 and a retry button, not a 30 s spinner |
| Queue grows for hours (provider slow) | Workers keep their concurrency; alert on oldest-job age; no new workers spawned without a limit |
| One user triggers 100 exports | Per-user in-flight limit (e.g. 2); the rest rejected with a clear message |
| Webhook storm from a provider | Webhook route has its own bulkhead; events recorded and processed by jobs |
| Retry storm after an outage | Clients and jobs use jitter; rate limits apply to retries too |
| 100×: sustained growth, not a spike | Shedding is a stopgap; capacity is added (`quality/scalability/horizontal-scaling.md`) |
| Twice / parallel: the same expensive request from many users | Coalesced or cached (`quality/performance/round-trips.md`) |

## Example — Standard / Advanced, Bun + Hono

```ts
const MAX_IN_FLIGHT = 200
let InFlight = 0

export const ShedLoad = createMiddleware(async (c, Next) => {
  if (InFlight >= MAX_IN_FLIGHT || EventLoopLagMs() > 200) {
    c.header("Retry-After", "5")
    return c.json({ Success: false, Error: { Code: "OVERLOADED", Message: T(c, "OVERLOADED") } }, 503)
  }
  InFlight++
  try {
    await Next()
  } finally {
    InFlight--
  }
})

App.use("/api/v1/public/*", ShedLoad)
```

```nginx
limit_req_zone $binary_remote_addr zone=auth:10m rate=10r/m;
location /api/v1/auth/ { limit_req zone=auth burst=5 nodelay; proxy_pass http://api; }
```

`EventLoopLagMs()` reads the value measured by the lag monitor in `quality/performance/event-loop-cpu.md`. Limits come from `SystemSettings` so they can be tuned during an event.

## Verify

- [ ] `[M]` Pool has a max size and an acquire timeout; a test with the pool exhausted fails fast.
- [ ] `[S]` 100 sign-in attempts per minute from one IP get `429`.
- [ ] `[S]` Queue depth and oldest-job age are on a dashboard or in an alert.
- [ ] `[A]` Under a load test above capacity, shed requests return 503 in < 20 ms and health stays green.

## Pitfalls

- **Accepting everything and queueing in memory** → OOM, then total outage → bounds and early rejection.
- **Scaling workers without limits** → the database becomes the bottleneck and falls over → fixed concurrency.
- **Shedding health checks or payment callbacks** → the balancer removes healthy instances, payments lost → exempt them.

## Related

`backend/reliability/rate-limit.md` · `quality/reliability/timeouts-retries.md` · `quality/performance/memory.md` · `quality/scalability/horizontal-scaling.md`
