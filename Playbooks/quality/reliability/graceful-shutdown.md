# Graceful shutdown

- **Situation:** deploys and restarts that drop requests or kill jobs halfway, PM2 reload, systemd stop, "a payment got stuck during deploy", connection errors right after a restart.
- **Skip when:** a CLI script that finishes on its own.
- **Decision:** on `SIGTERM` (or `SIGINT`) the process stops being ready, stops accepting new work, finishes what is in flight within a deadline, closes its pools, then exits 0. Past the deadline it exits anyway; jobs that didn't finish are retried because they are idempotent.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Every server: close the server and the pool on signal |
| Standard | Production: readiness drain, job workers drained, deadline |
| Advanced | Several instances behind a balancer, long-lived connections (SSE, WebSockets) |

## Rules

### Minimum — always, never cut

- A `SIGTERM` / `SIGINT` handler that stops the HTTP server, closes the database pool and exits.
- The handler runs once (a flag); a second signal forces an immediate exit.

### Standard — adds

- Order: mark not ready (`/ready` → 503) → wait a short drain delay (≈ 2–5 s, so the balancer or Nginx stops sending) → stop accepting → wait for in-flight requests → stop job workers after their current job → close Redis, then the DB pool → exit 0.
- A deadline below the supervisor's kill timeout (PM2 `kill_timeout`, systemd `TimeoutStopSec`): e.g. 10 s deadline with `kill_timeout: 15000`.
- PM2 `wait_ready: true` + `process.send("ready")` after boot, so `pm2 reload` only swaps to a process that is really up.
- Job workers stop taking new jobs on signal; a job still running at the deadline is left in a state the queue will retry (lease expiry), and its handler is idempotent.
- Nothing important happens in `process.on("exit")`: it can't await.

### Advanced — adds

- Long-lived connections (SSE, WebSockets) get a "reconnect" message and are closed at the start of the drain; clients reconnect to another instance.
- Shutdown duration logged and alerted when it hits the deadline often.

## Edge cases

| Case | Expected behaviour |
|---|---|
| A request is mid-transaction at the deadline | The process exits; Postgres rolls the transaction back; the client retries with its idempotency key |
| A job is calling a payment provider at the deadline | The job's idempotency key makes the retry safe; the provider is not charged twice |
| Signal arrives during boot (before ready) | Exit immediately; nothing to drain |
| Unhandled rejection during shutdown | Logged; exit non-zero after cleanup |
| Docker-free VPS with PM2 cluster mode | `pm2 reload` replaces workers one by one, each draining |
| 100×: 500 in-flight requests at deploy time | The drain delay and deadline cover them; requests slower than the deadline are what to fix, not the deadline to raise |
| Twice / parallel: two signals in quick succession | The first starts the drain; the second forces exit |

## Example — Standard, Bun + Hono

```ts
const Server = Bun.serve({ port: Env.PORT, fetch: App.fetch })
let ShuttingDown = false

async function Shutdown(Signal: string) {
  if (ShuttingDown) process.exit(1)
  ShuttingDown = true
  Logger.info({ Signal }, "shutdown started")
  MarkShuttingDown()
  const Deadline = setTimeout(() => { Logger.error("shutdown deadline reached"); process.exit(1) }, 10_000)
  await Bun.sleep(3_000)
  await Server.stop()
  await Jobs.StopWorkers()
  await Redis?.quit()
  await Pool.end()
  clearTimeout(Deadline)
  Logger.info("shutdown complete")
  process.exit(0)
}

process.on("SIGTERM", () => void Shutdown("SIGTERM"))
process.on("SIGINT", () => void Shutdown("SIGINT"))
process.send?.("ready")
```

```js
module.exports = { apps: [{ name: "api", script: "Src/Server.ts", interpreter: "bun", instances: "max", exec_mode: "cluster", wait_ready: true, listen_timeout: 10000, kill_timeout: 15000 }] }
```

`Server.stop()` without `true` waits for in-flight requests; `MarkShuttingDown` is the readiness flag from `quality/observability/health-checks.md`. If PM2 cluster mode with the Bun interpreter misbehaves on your versions, run one fork-mode process per core on separate ports behind Nginx `upstream`.

## Verify

- [ ] `[M]` `kill -TERM <pid>` while idle: process exits 0 within a second or two, pool closed.
- [ ] `[S]` During a load of steady requests, `pm2 reload api` produces zero 5xx and zero connection resets (k6 or `hey` during the reload).
- [ ] `[S]` A job running during the reload either finishes or is retried once with the same outcome.
- [ ] `[S]` `/ready` returns 503 during the drain.
- [ ] `[A]` SSE clients reconnect within seconds of a deploy.

## Pitfalls

- **`process.exit()` immediately on SIGTERM** → in-flight requests and jobs cut → drain first.
- **No deadline** → a stuck request blocks deploys → deadline below the kill timeout.
- **Closing the DB pool before the server** → in-flight requests fail on the way out → reverse order.

## Related

`quality/observability/health-checks.md` · `quality/availability/zero-downtime-deploy.md` · `backend/reliability/background-jobs.md`
