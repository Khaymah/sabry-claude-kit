# When to split a service

- **Situation:** "should this be a separate service / microservice?", a slow module, a second team, one feature that needs a different language, a worker that eats the API's CPU.
- **Skip when:** the split already happened or is contractually required (a vendor-hosted component); then follow `outbound-calls.md` for the boundary.
- **Decision:** default no. Stay a modular monolith (`modular-monolith.md`) and split only when one named trigger below is true with evidence. The owner's explicit decision wins, but state the costs before building.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Default: no split; separate the heavy part as a background worker running the same codebase |
| Standard | One trigger is proven: extract that one module behind an HTTP or queue contract |
| Advanced | Several teams with their own release cadence: per-service database, contract tests, tracing |

## Rules

### Minimum — always, never cut

- Do not split for "scalability", "clean architecture", a CV, or because a competitor did. None of these is a trigger.
- A heavy or slow part first becomes a job or a second process of the same app (`backend/reliability/background-jobs.md`), which is not a new service.
- If you do split, the new service owns its data. Two services never share tables; a shared database is a monolith with extra latency.

### Standard — adds

The triggers, any one with evidence:

- **Independent scaling, measured:** one module needs 10× the machines of the rest, shown by profiling and load numbers, and a worker process of the same app does not solve it.
- **Different runtime:** a real need for another language or hardware (GPU model, Python ML, a native library).
- **Separate team and release cadence:** a team that ships on its own schedule and is blocked by the shared release, for at least a quarter.
- **Compliance isolation:** card data, health data or a regulator requires a separate boundary, access list and audit.

Before extracting:

- The module already passes the monolith boundary rules: its own tables, public service only, no cross-module joins. If it does not, fix that first; it is cheaper and the split then becomes a deployment change.
- Decide sync (HTTP with timeout, retry, breaker: `backend/reliability/outbound-calls.md`) or async (events: `events-side-effects.md`) per call, not "everything over HTTP".
- Every call across the new boundary can fail, time out, or run twice, so each has an idempotency key and a stated fallback.

### Advanced — adds

- Per-service database, migrations and on-call owner; shared types come from a versioned contract (`contract-first.md`).
- Distributed tracing with a request id passed across every hop before the second service goes to production.
- No cross-service transactions: use a saga with explicit compensation, or move the data back into one service.

## What a split costs

| Cost | Concretely |
|---|---|
| Consistency | Cross-module transactions disappear; you need outbox, sagas, reconciliation |
| Latency and failure | A function call becomes a network call that fails, hangs and retries |
| Operations | Another deploy pipeline, health checks, alerts, secrets, logs, on-call |
| Testing | Local setup needs both services; end-to-end tests become slower and flakier |
| Money | More machines idle at low load, plus the engineering time of all the above |

## Edge cases

| Case | Expected behaviour |
|---|---|
| One report query makes the API slow | Index, read replica, cache or a job; not a service |
| PDF generation spikes CPU | A worker process on the same code with its own queue and machine size |
| A second team joins the project | Lint-enforced module ownership first; split only if release cadence is the proven pain |
| ML model in Python, API in TypeScript | A small inference service behind one endpoint with a timeout and a fallback result |
| Payment provider certification requires isolation | Extract only the card-touching code; the rest stays in the monolith |
| The monolith has cross-module joins | Not split-ready; replace the joins with public service calls first |
| Data at 100×: the extracted service's table is read by the monolith "for speed" | Forbidden; expose a batch endpoint or replicate through events, never share the table |
| Twice / parallel: the monolith retries a call to the new service after a timeout | The service treats the request id as an idempotency key; the second call returns the first result |

## Example — Minimum, a worker of the same app

```ts
const Role = Bun.env.APP_ROLE ?? "api"

if (Role === "api") Bun.serve({ port: 3000, fetch: App.fetch })
if (Role === "worker") await StartWorker()
```

Same build, two systemd units: `APP_ROLE=api` scaled for requests, `APP_ROLE=worker` scaled for jobs. The cheapest answer to "this part is heavy".

Other stacks: Laravel Horizon workers, Django Celery workers, same codebase and different process types.

## Verify

- [ ] `[M]` The proposal names one trigger and the number or fact that proves it (profile, headcount, regulation).
- [ ] `[M]` No two services read or write the same table.
- [ ] `[S]` Every cross-service call has a timeout, an idempotency key and a stated fallback.
- [ ] `[S]` The module passes the boundary lint before extraction.
- [ ] `[A]` A request id appears in logs of every service it crossed.

## Pitfalls

- **Splitting to fix a slow query** → same query, now with a network hop → fix the query.
- **Shared database "temporarily"** → permanent hidden coupling → a batch endpoint or events.
- **Synchronous chain of five services** → availability multiplies down → async where the caller does not need the answer.
- **Splitting before boundaries exist** → the distributed mess of the monolith's cycles → modularize first.

## Related

`architecture/modular-monolith.md` · `architecture/events-side-effects.md` · `architecture/contract-first.md` · `backend/reliability/outbound-calls.md` · `backend/reliability/background-jobs.md`
