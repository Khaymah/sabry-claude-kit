# Distributed tracing

- **Situation:** a request crosses several services or queues and you can't tell where the time or the failure is; OpenTelemetry; "which call is slow?".
- **Skip when:** a single service with one database. Request correlation (`quality/observability/request-correlation.md`) and slow-query logs answer the same questions there for free.
- **Decision:** OpenTelemetry SDK with auto-instrumentation for HTTP, the database and the queue, W3C `traceparent` propagated through every hop including job payloads, sampled at the head, exported to one backend.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Not required |
| Standard | Not required; use request ids |
| Advanced | Two or more services, or queues whose latency matters to users |

## Rules

### Minimum

- Nothing to add.

### Standard

- Nothing to add. If a single service is slow, use `quality/performance/profiling.md` and `pg_stat_statements` first.

### Advanced — adds

- OpenTelemetry SDK initialised before the app imports anything else; service name and version as resource attributes.
- Auto-instrumentation for the HTTP server and client, Postgres driver and Redis; manual spans only around business steps worth seeing (`Checkout.Price`, `Checkout.Charge`).
- Context propagation: `traceparent` on outbound HTTP; jobs store the trace context in their payload and start a linked span when run.
- Head sampling 5–20% in production, 100% for errors when the backend supports tail sampling.
- The trace id is added to log lines and to error-tracker events, so the three tools link.
- Exporter to Grafana Tempo, Jaeger, Honeycomb or the error tracker's tracing; the OTLP endpoint and the sampling rate are bootstrap values in the environment, because tracing starts before the database is reachable (a stated exception to the four-variable rule in `Stacks/Database.md` §1).
- Span attributes never hold personal data or secrets: ids and sizes only.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Bun runtime and Node-only auto-instrumentations | Use the instrumentations known to work on Bun (HTTP, `pg`), add manual spans for the rest, and verify spans arrive |
| Job runs hours after the request | Linked span (not a child), so the request trace doesn't stretch for hours |
| Third-party API that doesn't propagate | Our client span still measures it; that is enough |
| Exporter backend down | Spans dropped in batch, never blocking requests |
| Very high traffic | Lower the head sample rate; keep errors |

## Example — Advanced, Node / Bun

```ts
import { NodeSDK } from "@opentelemetry/sdk-node"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http"
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http"
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg"
import { TraceIdRatioBasedSampler, ParentBasedSampler } from "@opentelemetry/sdk-trace-base"

new NodeSDK({
  serviceName: "api",
  traceExporter: new OTLPTraceExporter({ url: Bun.env.OTEL_EXPORTER_OTLP_ENDPOINT }),
  sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(Number(Bun.env.OTEL_TRACES_SAMPLER_ARG ?? "0.1")) }),
  instrumentations: [new HttpInstrumentation(), new PgInstrumentation()],
}).start()
```

This file is loaded first (`bun --preload ./Src/Tracing.ts Src/Server.ts`). The endpoint and the sample rate are read from the environment because tracing starts before the database is reachable.

## Verify

- [ ] `[A]` One request that enqueues a job shows the HTTP span, DB spans and the linked job span in the backend.
- [ ] `[A]` Log lines of that request carry the same trace id.
- [ ] `[A]` Sampling rate is below 1.0 in production; errors are still visible.
- [ ] `[A]` No span attribute contains an email, token or full body.

## Pitfalls

- **Tracing a monolith "for completeness"** → cost and setup with no new answers → request ids and query stats.
- **Initialising after imports** → no auto-instrumentation → preload.
- **Losing context at the queue** → traces end at "enqueue" → carry `traceparent` in the payload.

## Related

`quality/observability/request-correlation.md` · `quality/observability/metrics.md` · `architecture/when-to-split-service.md`
