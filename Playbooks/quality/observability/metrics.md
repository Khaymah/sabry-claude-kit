# Metrics

- **Situation:** dashboards, "is it slower than last week?", capacity questions, Prometheus or Grafana, business KPIs from the system.
- **Skip when:** Minimum and most Standard projects: uptime checks, the error tracker and host metrics answer the real questions. Add application metrics when someone will look at them.
- **Decision:** RED for every request path and job (Rate, Errors, Duration as a histogram), USE for hosts (Utilisation, Saturation, Errors), labelled by route pattern and status class only; exposed in Prometheus format and scraped privately.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Not required |
| Standard | Host metrics only (CPU, memory, disk, Postgres connections) |
| Advanced | SLOs, several instances, performance commitments |

## Rules

### Minimum

- Nothing to add.

### Standard — adds

- Host metrics on the VPS: Netdata, or `node_exporter` + `postgres_exporter`, with alerts on disk > 80%, memory > 90%, and Postgres connections > 80% of `max_connections`.
- Disk is the first thing that kills a VPS: logs, backups and uploads each have a retention or a size alert.

### Advanced — adds

- App metrics with `prom-client` (or OpenTelemetry metrics): `http_requests_total{route,method,status_class}`, `http_request_duration_seconds` histogram (buckets 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5), `jobs_total{name,outcome}`, `job_duration_seconds`, `queue_depth{name}`, DB pool in use and waiting.
- `/metrics` listens on a private port or is allowed only from the Prometheus host in Nginx; never public.
- Business counters that matter to the owner (orders paid, sign-ups) as metrics with no user labels.
- Dashboards per service: RED panel, saturation panel, top slow routes, error ratio by route. Grafana Cloud free tier or self-hosted Grafana.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Label with user id, email, raw URL or order id | Forbidden: unbounded cardinality kills Prometheus. Use route pattern and status class |
| Several PM2 cluster workers | Each worker's registry is aggregated (`prom-client` `AggregatorRegistry`) or each worker gets its own port and label |
| Very fast endpoints dominate the averages | Histograms and percentiles (p95, p99), never averages alone |
| Long-running streams (SSE) | Duration measured to first byte plus a separate open-connections gauge |
| Metric names change | Treated like an API: dashboards and alerts updated in the same change |
| 100×: Request rate 100× higher | Metric cost stays flat because labels are bounded; scrape interval unchanged |
| Twice / parallel: Several workers update the same counter | Per-worker registries, aggregated at scrape time |

## Example — Advanced, Bun + Hono

```ts
import { Counter, Histogram, Registry, collectDefaultMetrics } from "prom-client"

export const Metrics = new Registry()
collectDefaultMetrics({ register: Metrics })

const Requests = new Counter({ name: "http_requests_total", help: "HTTP requests", labelNames: ["route", "method", "status_class"], registers: [Metrics] })
const Duration = new Histogram({ name: "http_request_duration_seconds", help: "HTTP duration", labelNames: ["route", "method"], buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5], registers: [Metrics] })

export const RecordMetrics = createMiddleware(async (c, Next) => {
  const End = Duration.startTimer()
  await Next()
  const Labels = { route: c.req.routePath, method: c.req.method }
  End(Labels)
  Requests.inc({ ...Labels, status_class: `${Math.floor(c.res.status / 100)}xx` })
})

InternalApp.get("/metrics", async (c) => c.text(await Metrics.metrics(), 200, { "Content-Type": Metrics.contentType }))
```

`InternalApp` listens on `127.0.0.1:9100`; Prometheus scrapes it locally or through a private network.

## Verify

- [ ] `[S]` Host dashboard shows CPU, memory, disk and Postgres connections; a disk-usage alert exists.
- [ ] `[A]` `curl https://<public-domain>/metrics` returns 404 or 403.
- [ ] `[A]` No label value set grows with users (`count by (__name__)` stays flat over a day).
- [ ] `[A]` p95 per route visible for the last 7 days.

## Pitfalls

- **Metrics nobody looks at** → cost and noise → start from the questions and the alerts.
- **High-cardinality labels** → memory blow-up → bounded label sets only.
- **Averages** → hide the slow tail users feel → histograms.

## Related

`quality/observability/alerting.md` · `quality/performance/performance-budget.md` · `devops/INDEX.md`
