# Error tracking

- **Situation:** crashes nobody reports, "the client says it broke but logs show nothing", unhandled errors in the browser or the mobile app, Sentry setup, grouping and noise.
- **Skip when:** a prototype with no users; logs are enough until real users arrive.
- **Decision:** unhandled errors on server, web and mobile go to one error tracker (Sentry SaaS, or self-hosted GlitchTip), tagged with release, environment and request id; expected business errors never do.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Not required; logs only |
| Standard | Any production app with real users |
| Advanced | Paying customers with an SLA; mobile apps at scale |

## Rules

### Minimum

- Nothing beyond logging; do not add a tracker to a prototype.

### Standard — adds

- One project per surface (api, web, mobile) in the tracker, DSN from `SystemSettings` (server) or build-time public config (web/mobile).
- Initialise before anything else so startup errors are caught; the error middleware reports only 5xx and unknown errors.
- Every event has `release` (git sha or version), `environment` (`APP_ENV`), `RequestId`, and `UserId` (an id, never email or name).
- Source maps uploaded on each web build and deleted from the public bundle; release created in the deploy script.
- `beforeSend` drops request bodies and cookies, and scrubs the same keys as the logger.
- An alert rule: a new issue or a spike in an existing one notifies a human (`quality/observability/alerting.md`).

### Advanced — adds

- Performance monitoring sampled (`tracesSampleRate` 0.05–0.2), not 1.0.
- Issues linked to the tracker of record (GitHub issues); a weekly triage of the top issues by users affected.
- Mobile: crash-free sessions as a release health metric, with a threshold that blocks the staged rollout.

## Edge cases

| Case | Expected behaviour |
|---|---|
| `AppError` with 4xx (validation, not found, declined) | Not reported; it is a normal response |
| Same error thrown 10,000 times in a loop | One issue; rate limit and fingerprint rules keep the quota |
| Browser extension or third-party script errors | Filtered by `allowUrls` set to our own domains |
| Error before the tracker initialises (bad config) | Process logs it and exits non-zero; PM2 or systemd restarts and the uptime alert fires |
| The tracker is down or blocked | The SDK drops events without affecting requests; nothing awaits it on the request path |
| Client asks for no third-party data processing | Self-hosted GlitchTip on our VPS, same SDK |
| 100×: Error volume 100× higher | Sample rate and per-issue rate limits; a quota alert before the plan runs out |
| Twice / parallel: The same error hits many users at once | One issue grouped by fingerprint, with a user count, not thousands of issues |

## Example — Standard, Bun + Hono

```ts
import * as Sentry from "@sentry/bun"
import { version as AppVersion } from "../../package.json"

Sentry.init({
  dsn: GetSetting("Observability.SentryDsn"),
  environment: Env.APP_ENV,
  release: AppVersion,
  sendDefaultPii: false,
  beforeSend(Event) {
    delete Event.request?.cookies
    delete Event.request?.data
    return Event
  },
})

App.onError((Err, c) => {
  const IsExpected = Err instanceof AppError && Err.Status < 500
  if (!IsExpected) {
    Sentry.withScope((Scope) => {
      Scope.setTag("RequestId", c.get("RequestId"))
      Scope.setUser(c.get("User") ? { id: c.get("User").Id } : null)
      Sentry.captureException(Err)
    })
    c.get("Log").error({ err: Err }, "unhandled error")
  }
  return ErrorResponse(c, Err)
})
```

Other stacks: `@sentry/nextjs` (wizard sets client, server and edge); `@sentry/react-native` with release health; Laravel `sentry/sentry-laravel`.

## Verify

- [ ] `[S]` A forced 500 appears in the tracker within a minute with release, environment and `RequestId`.
- [ ] `[S]` A 400 validation error does not appear.
- [ ] `[S]` A minified web stack trace is readable (source maps work), and `.map` files return 404 publicly.
- [ ] `[S]` The event contains no cookie, password or request body.
- [ ] `[A]` Sample rate below 1.0; quota usage under the plan.

## Pitfalls

- **Reporting every 4xx** → thousands of issues, real ones buried → report 5xx and unknown only.
- **No release tag** → can't tell if a deploy caused or fixed it → set `release` in every build.
- **Public source maps** → full source exposed → upload, then delete from the bundle.

## Related

`quality/observability/logging.md` · `quality/observability/alerting.md` · `quality/reliability/error-handling.md`
