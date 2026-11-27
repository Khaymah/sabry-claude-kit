# Quality baseline

Paths are relative to `Playbooks/`. Read with **every** task that writes or reviews code, after picking the project's level (`Playbooks/INDEX.md`). Apply your level and every level under it. Each line links to the playbook to open **only** when the task touches that area.

## Minimum — every project, every task

- **Maintainability:** follow the codebase's existing structure, layers and naming before any convention of your own; reuse before adding; no dead code, no speculative options. → `quality/maintainability/naming-structure.md`
- **Complexity:** a function does one thing and fits on a screen; nesting ≤ 3; file ≤ 600 lines. → `quality/maintainability/complexity-limits.md`
- **Errors:** no empty `catch`, no swallowed promise; every error is handled where it can be fixed or reaches the one error handler. → `quality/reliability/error-handling.md`
- **Outbound calls:** every network call has a timeout. → `quality/reliability/timeouts-retries.md`
- **Logs:** server code logs through the project logger, never `console.log`; every error is logged once, with context, without secrets or personal data. → `quality/observability/logging.md`
- **Health:** a `GET /health` that answers without touching dependencies. → `quality/observability/health-checks.md`
- **Tests:** new logic with a branch, money, security or parsing has a test; the suite is green before "done". → `quality/testability/test-strategy.md`
- **Security floor:** input validated at the boundary, authorization on every resource, no secrets in code. → `security/INDEX.md`
- **Performance floor:** no query in a loop (N+1); many items cost one round trip, not one per item; settings and reference data read from memory; lists paginated and capped; input arrays and strings have a `.max()`; no `*Sync` call or nested list scan on a request path. → `quality/performance/query-performance.md` · `quality/performance/round-trips.md` · `quality/performance/event-loop-cpu.md`
- **Memory floor:** body size limits; no whole-table loads; no global collection that grows without eviction. → `quality/performance/memory.md`
- **Traps:** run the Detect column of `quality/TRAPS.md` on what you touched. → `quality/TRAPS.md`

## Standard — adds (production, real users)

- **Boundaries:** a module never imports another module's internals; it calls that module's service or listens to its events. → `quality/maintainability/module-boundaries.md`
- **Design principles:** abstractions only where a second implementation exists or is contracted (providers, channels). → `quality/maintainability/solid-pragmatic.md`
- **Correlation:** a request id enters at the edge and appears in every log line, job and outbound call. → `quality/observability/request-correlation.md`
- **Error tracking:** unhandled errors reach an error tracker tagged with release and environment. → `quality/observability/error-tracking.md`
- **Alerting:** an external uptime check and an error-rate alert reach a human. → `quality/observability/alerting.md`
- **Shutdown:** SIGTERM drains requests and jobs before exit. → `quality/reliability/graceful-shutdown.md`
- **Batching:** bulk writes chunked, `Promise.all` over dynamic lists bounded, query-count tests on list endpoints, exports streamed, caches LRU-bounded. → `quality/performance/round-trips.md` · `quality/performance/memory.md`
- **Slow work:** anything over ~1 s or scheduled runs in a background job. → `backend/reliability/background-jobs.md`
- **Tests:** each endpoint has an integration test for its happy path and main failure, on a real database, in CI. → `quality/testability/integration-db.md`
- **Deploys:** zero-downtime reload; backups with a rehearsed restore. → `quality/availability/zero-downtime-deploy.md` · `devops/INDEX.md`
- **CI:** typecheck, lint and tests block the merge; lint uses the kit preset (`Templates/eslint/`) or carries its rules. → `practices/code-review.md` · `Templates/eslint/README.md`

## Advanced — adds (scale, sensitive data, SLA)

- **Metrics and SLOs:** rate, errors and duration per endpoint and job; SLOs with burn-rate alerts. → `quality/observability/metrics.md` · `quality/observability/alerting.md`
- **Tracing:** distributed traces across services and queues. → `quality/observability/tracing.md`
- **Resilience:** circuit breakers on dependencies, load shedding, backpressure on queues. → `quality/reliability/backpressure.md`
- **Scale:** stateless processes proven with two instances; shared state in Redis; replicas only when measured. → `quality/scalability/stateless.md` · `quality/scalability/horizontal-scaling.md`
- **Tests:** load test before launch, concurrency tests on races, contract tests for public APIs. → `quality/testability/concurrency-tests.md` · `quality/testability/e2e.md`
- **Debt:** a debt register reviewed each month; dependency updates on a schedule. → `quality/maintainability/tech-debt.md` · `practices/dependency-management.md`

## Report line

`Baseline: Standard ✓` or the items not met, each with the reason (`no error tracker: client declined, logged in .agents/memory`).
