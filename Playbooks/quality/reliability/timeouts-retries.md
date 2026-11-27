# Timeouts, retries and circuit breakers

- **Situation:** calling payment gateways, SMS, email, LLM APIs, maps, any HTTP service; "the site hangs when the provider is slow"; deciding whether to retry; a provider outage taking us down.
- **Skip when:** calls inside the same process.
- **Decision:** every outbound call has a timeout; only idempotent calls (or calls with an idempotency key) are retried, at most 3 attempts with exponential backoff and full jitter, honouring `Retry-After`; a dependency that keeps failing is cut off by a circuit breaker so we fail fast instead of piling up.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Every outbound call: a timeout |
| Standard | Production: retries with backoff for safe calls, slow work moved to jobs |
| Advanced | Dependencies whose outages are frequent or costly: circuit breakers, bulkheads |

## Rules

### Minimum — always, never cut

- `fetch` and SDK calls get a timeout: `signal: AbortSignal.timeout(ms)` or the SDK's `timeout` option. Defaults: 5 s for APIs in a request, 30 s in jobs, LLM streaming by time-to-first-token (10 s) plus a total cap.
- Database: `statement_timeout` on the server or connection (e.g. 5 s for the API role), and a pool acquire timeout.
- Never retry a non-idempotent call (charge, send SMS, create order on a provider) without an idempotency key the provider honours.

### Standard — adds

- One shared `OutboundFetch` helper: timeout, retry policy, logging of provider, duration and status; every adapter uses it.
- Retry only on network errors, timeouts, `429` and `5xx`; never on other `4xx`.
- Backoff with full jitter: `delay = random(0, min(cap, base × 2^attempt))`, base 200 ms, cap 5 s, max 3 attempts; `Retry-After` wins when present.
- Total time budget: a request's retries fit inside its own timeout; long retry chains belong in a background job.
- Calls the user doesn't wait for (emails, webhooks to clients, syncing) run in jobs, whose retries span minutes to hours.
- Timeouts and retry counts per provider live in `SystemSettings`.

### Advanced — adds

- A circuit breaker per dependency: after N failures in a window (e.g. 50% of 20 calls), open for 30 s and fail fast with `PROVIDER_UNAVAILABLE`; half-open lets one call test recovery.
- Bulkheads: a concurrency limit per dependency, so a slow provider can't take every connection or worker.
- Fallbacks where the product allows (second SMS provider, cached exchange rate with its age shown).

## Edge cases

| Case | Expected behaviour |
|---|---|
| Timeout after the provider already processed the request | The retry carries the same idempotency key, so the provider returns the first result |
| Provider returns `429` with `Retry-After: 60` in a request path | Don't wait 60 s in the request: fail with `503 RATE_LIMITED_UPSTREAM` or move to a job |
| Provider down for an hour | Breaker open, fast failures, alert fires; queued jobs retry with growing delays |
| DNS failure or TLS error | Treated as a network error: retried, then reported |
| Streaming response that stalls mid-way | An idle timeout between chunks, not only a total timeout |
| 100×: traffic spikes against a rate-limited provider | Concurrency limit + token bucket below the provider's limit; excess queued |
| Twice / parallel: many requests retry at the same moment | Jitter spreads them; the breaker stops the herd when the provider is down |

## Example — Standard, TypeScript

```ts
const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504])

type TOutbound = RequestInit & { Provider: string; TimeoutMs?: number; Retries?: number; Idempotent?: boolean }

export async function OutboundFetch(Url: string, Init: TOutbound, Attempt = 1): Promise<Response> {
  const Attempts = Init.Idempotent ? (Init.Retries ?? 3) : 1
  const Start = performance.now()
  try {
    const Res = await fetch(Url, { ...Init, signal: AbortSignal.timeout(Init.TimeoutMs ?? 5_000) })
    Logger.info({ Provider: Init.Provider, Status: Res.status, DurationMs: Math.round(performance.now() - Start), Attempt }, "outbound")
    if (!RETRYABLE.has(Res.status) || Attempt >= Attempts) return Res
    await Bun.sleep(Backoff(Attempt, Res.headers.get("Retry-After")))
  } catch (Err) {
    if (Attempt >= Attempts) throw new AppError("PROVIDER_UNAVAILABLE", 503, { Provider: Init.Provider })
    Logger.warn({ Provider: Init.Provider, err: Err, Attempt }, "outbound failed")
    await Bun.sleep(Backoff(Attempt, null))
  }
  return OutboundFetch(Url, Init, Attempt + 1)
}

function Backoff(Attempt: number, RetryAfter: string | null) {
  const Seconds = Number(RetryAfter)
  if (RetryAfter && Number.isFinite(Seconds)) return Math.min(Seconds * 1_000, 5_000)
  return Math.random() * Math.min(5_000, 200 * 2 ** Attempt)
}
```

Each attempt calls the next one after its backoff, so attempts stay sequential without an `await` in a loop. Advanced: wrap `OutboundFetch` per provider with a breaker (`opossum`, or a small counter in memory per instance).

## Verify

- [ ] `[M]` `grep -rn "fetch(" Src/ | grep -v signal` finds no direct calls outside `OutboundFetch`.
- [ ] `[M]` The API database role has a `statement_timeout`.
- [ ] `[S]` A test server that sleeps 10 s makes the call fail at the timeout with `PROVIDER_UNAVAILABLE`.
- [ ] `[S]` A `POST` charge is retried only when an idempotency key is passed.
- [ ] `[A]` With the provider down, after the breaker opens, calls fail in < 10 ms.

## Pitfalls

- **No timeout** → one slow provider exhausts every connection → timeout everything.
- **Retrying a charge without a key** → double charges → key or no retry.
- **Fixed-delay retries without jitter** → synchronized retry storms → full jitter.

## Related

`backend/reliability/idempotency.md` · `backend/reliability/outbound-calls.md` · `quality/reliability/backpressure.md` · `quality/reliability/error-handling.md`
