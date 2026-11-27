# Quality playbooks — the "-ilities"

Start with `BASELINE.md` on every code task, and scan `TRAPS.md` (mechanical checks for the common traps) before calling it done. Open a file below only when the task touches its area. `planned` = not written yet.

Design-time questions for each quality stay in `Quality-Gate.md`; these files are the implementation at each level.

## Maintainability

| Situation | File | Status |
|---|---|---|
| SOLID, interfaces, "should this be abstract?", dependency injection | `maintainability/solid-pragmatic.md` | ✅ |
| New module, who may import what, shared code | `maintainability/module-boundaries.md` | ✅ |
| Naming, folder layout, where a file goes | `maintainability/naming-structure.md` | ✅ |
| Long functions, deep nesting, big files, god services | `maintainability/complexity-limits.md` | ✅ |
| Changing old code safely, cleaning up while fixing | `maintainability/refactoring.md` | ✅ |
| Shortcuts, TODOs, "we'll fix it later" | `maintainability/tech-debt.md` | ✅ |

## Observability

| Situation | File | Status |
|---|---|---|
| Logs, log levels, what to log and never log | `observability/logging.md` | ✅ |
| Request id, following one request through logs and jobs | `observability/request-correlation.md` | ✅ |
| Sentry, crash reports, unhandled errors | `observability/error-tracking.md` | ✅ |
| Metrics, dashboards, RED / USE, Prometheus | `observability/metrics.md` | ✅ |
| Health, readiness, liveness, uptime checks | `observability/health-checks.md` | ✅ |
| Alerts, on-call, SLOs, "tell me when it breaks" | `observability/alerting.md` | ✅ |
| Distributed tracing, OpenTelemetry | `observability/tracing.md` | ✅ |

## Reliability

| Situation | File | Status |
|---|---|---|
| try/catch, error classes, error middleware, unhandled rejections | `reliability/error-handling.md` | ✅ |
| Shutdown, restarts, deploys dropping requests | `reliability/graceful-shutdown.md` | ✅ |
| Timeouts, retries, backoff, circuit breaker | `reliability/timeouts-retries.md` | ✅ |
| Overload, queues growing, load shedding | `reliability/backpressure.md` | ✅ |

## Availability

| Situation | File | Status |
|---|---|---|
| Deploy without downtime, reload, blue-green | `availability/zero-downtime-deploy.md` | planned |
| Failover, second server, database replica promotion | `availability/failover.md` | planned |

## Scalability

| Situation | File | Status |
|---|---|---|
| Stateless processes, sessions and files outside the process | `scalability/stateless.md` | planned |
| More than one instance, load balancing, cluster mode | `scalability/horizontal-scaling.md` | planned |
| Read-heavy load, replicas | `scalability/read-replicas.md` | planned |
| Huge tables, partitioning, archiving | `scalability/partitioning.md` | planned |

## Performance

| Situation | File | Status |
|---|---|---|
| Slow queries, N+1, EXPLAIN, indexes, related rows | `performance/query-performance.md` | ✅ |
| Many items: batching, bulk insert, settings snapshot, `Promise.all`, concurrency limits | `performance/round-trips.md` | ✅ |
| Exports, uploads, caches, memory growth, OOM | `performance/memory.md` | ✅ |
| Heavy computation, nested loops, regex, sync APIs, event-loop lag | `performance/event-loop-cpu.md` | ✅ |
| "It's slow", performance targets | `performance/performance-budget.md` | planned |
| Finding the slow part, profiling | `performance/profiling.md` | planned |

## Testability

| Situation | File | Status |
|---|---|---|
| What to test, how much, test pyramid | `testability/test-strategy.md` | ✅ |
| Tests against a real database | `testability/integration-db.md` | ✅ |
| End-to-end and browser tests | `testability/e2e.md` | ✅ |
| Races, double spending, parallel requests | `testability/concurrency-tests.md` | ✅ |
| Fixtures, factories, seeds | `testability/test-data.md` | ✅ |

## Cost

| Situation | File | Status |
|---|---|---|
| Server size, monthly bill, "do we need a bigger server?" | `cost/infra-sizing.md` | planned |
| LLM tokens, model choice by cost | `cost/llm-cost.md` | planned |
