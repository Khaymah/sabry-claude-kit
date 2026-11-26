# Logging

- **Situation:** adding logs, choosing log levels, "why did this fail in production?", logs too noisy or empty, log storage and rotation.
- **Skip when:** never for server code. Frontend logging is error tracking (`quality/observability/error-tracking.md`).
- **Decision:** structured JSON logs through one project logger (pino in Node/Bun), one event per line with a stable message and fields, never secrets or personal data, written to stdout and rotated by the platform.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Every server |
| Standard | Production with real users |
| Advanced | Several instances or services, regulated data |

## Rules

### Minimum — always, never cut

- One logger module (`Config/Logger.ts`); no `console.log` in server code.
- JSON lines with `level`, `time`, `msg` and fields; the message is a stable sentence (`"order paid"`), values go in fields (`{ OrderId, AmountMinor }`), never interpolated into `msg`.
- Levels: `error` = someone must act; `warn` = unexpected but handled; `info` = business events and lifecycle (start, stop, job done); `debug` = off in production.
- Every caught error that is not rethrown is logged once with `err` (stack included) and the ids needed to find the case. Rethrown errors are logged by the error handler only, never at each layer.
- Redact by config, not by memory: `password`, `token`, `authorization`, `cookie`, `secret`, `apiKey`, card numbers, full request bodies of auth routes.

### Standard — adds

- Every line carries `RequestId` (and `UserId`, `TenantId` when known) through a child logger (`quality/observability/request-correlation.md`).
- One access-log line per request: method, route pattern (not the raw URL with ids), status, duration, size. Health checks are not logged.
- Log level from `SystemSettings` (`Logging.Level`) so it can change without a deploy.
- Rotation and retention: PM2 `pm2-logrotate` or `logrotate` (daily, 14 days, compressed) on the VPS; journald if run under systemd.
- Personal data: user ids, not emails or phone numbers; IPs only where needed for security, with the retention stated.

### Advanced — adds

- Shipped to a central store (Grafana Loki, Better Stack, Elastic) with the service name and version as labels; queries saved for the top incidents.
- An audit log (who did what to which record) is a database table, not the application log (`backend/data/audit-log.md`).
- Log volume budget: per-request `info` lines capped; sampling for high-volume success paths.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Error object from a library with circular references or huge payloads | Logged through pino's `err` serializer; provider responses truncated to a size limit |
| Error thrown inside a background job | Logged by the job runner with `JobId`, job name and attempt number |
| Validation failures (400s) | `info` or not at all; they are the client's mistake, not an alert |
| Expected business outcomes (card declined) | `info` with the reason code, not `error` |
| A log line would include a whole user or order object | Log ids and the 2–3 fields that matter |
| Logging inside a hot loop | Aggregate: one line with counts after the loop |

## Example — Standard, Bun + Hono

```ts
import pino from "pino"
import { version as AppVersion } from "../../package.json"

export const Logger = pino({
  level: "info",
  base: { Service: "api", Version: AppVersion },
  redact: {
    paths: ["*.password", "*.Password", "*.token", "*.Token", "*.authorization", "*.cookie", "*.ApiKey", "*.Secret", "req.headers.authorization", "req.headers.cookie"],
    censor: "[redacted]",
  },
  serializers: { err: pino.stdSerializers.err },
})

export const AccessLog = createMiddleware<AppEnv>(async (c, Next) => {
  const Start = performance.now()
  await Next()
  if (c.req.path === "/health") return
  c.get("Log").info({ Method: c.req.method, Route: c.req.routePath, Status: c.res.status, DurationMs: Math.round(performance.now() - Start) }, "request")
})
```

Boot starts at `info`; after settings load, `Logger.level = GetSetting("Logging.Level")`, and the settings cache invalidation sets it again on change.

Other stacks: Next.js server code uses the same pino logger; Laravel uses its `Log` facade with the JSON formatter; Go `log/slog` with the JSON handler.

## Verify

- [ ] `[M]` `grep -rn "console\.\(log\|error\)" Src/` finds nothing outside scripts.
- [ ] `[M]` Sign-in with a wrong password: the logs contain no password or token (`grep -i password` on the log output).
- [ ] `[M]` A forced error produces exactly one `error` line with a stack.
- [ ] `[S]` Every line of one request shares the same `RequestId`; `/health` produces no line.
- [ ] `[S]` Log files rotate (check `pm2 conf pm2-logrotate` or `/etc/logrotate.d/`).
- [ ] `[A]` A query in the central store finds a request by `RequestId` within a minute.

## Pitfalls

- **Logging the error at every layer** → one failure looks like five → log where handled.
- **`logger.info(\`user ${Id} paid ${Amount}\`)`** → impossible to query → fields.
- **Raw URL in the access log** → ids and tokens in query strings leak, cardinality explodes → route pattern.

## Related

`quality/observability/request-correlation.md` · `quality/observability/error-tracking.md` · `quality/reliability/error-handling.md`
