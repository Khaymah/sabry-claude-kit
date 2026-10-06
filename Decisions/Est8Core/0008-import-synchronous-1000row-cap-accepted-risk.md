# ADR-0008 — Import: synchronous 1000-row cap accepted as MVP risk (Queue deferred)

- **Status:** Accepted
- **Date:** 2026-06-13
- **Deciders:** Sabry
- **Project:** Est8Core
- **Tags:** import, queue, performance, mvp, accepted-risk

## Context

The Import module (CSV import for leads and contacts) was designed as a synchronous handler with a hard cap of `MAX_IMPORT_ROWS = 1000` rows per call. Gap #10 in the DoD Gap Board (22-DoD-Gap-Board.md) flags this as a Queue candidate — background processing via BullMQ/Redis would decouple the HTTP response from heavy processing and enable unlimited batch sizes.

However, the board itself offers an explicit alternative: **ADR يقبل الحد (1000 صف) كـ accepted-risk للـMVP** — precisely because the module is already bounded by multiple overlapping guards:

1. `MAX_IMPORT_ROWS = 1000` — hard row limit enforced before row loop (immediate Err on violation).
2. `ParseCsvText` sentinel — exits early at `MAX_IMPORT_ROWS × 2` lines before building objects.
3. `bodyLimit` middleware — rejects bodies > 2 MB (≈ 10,000+ realistic rows) before the handler executes.
4. Sequential `await` per row: CreateLead/CreateContact each have their own DB round-trip, so worst-case 1000 rows × ~5ms/row = ~5 seconds. This is within HTTP timeout limits for MVP load.

Converting to async Queue would:
- Break the synchronous response contract (`{total, created, deduped, failed[]}` at 200) — callers would need a polling job-status endpoint, a separate change outside the board's surgical scope.
- Invalidate ~20 existing integration tests that assert on synchronous result bodies.
- Be a no-op in CI (Enqueue is no-op when `REDIS_URL` is absent — queue infrastructure is BullMQ/Redis which is not configured in the test environment).

## Decision

**Keep ImportLeads and ImportContacts synchronous with the 1000-row cap for MVP.** The Queue path is deferred until one of the following triggers is met:

- p95 import latency > 10 seconds in production monitoring.
- Row cap needs to rise above 1000 (business request or customer need).
- A new job-status UI is being built anyway (e.g. for Export async results).

## Considered Options

### Option 1: Enqueue on every import call (async, return 202 + jobId)
- **Pros:** Decoupled, scalable, handles large batches.
- **Cons:** Breaks existing API contract (200 → 202); requires job-status endpoint; invalidates all existing tests; no-op in CI/CD without Redis.

### Option 2: Enqueue only when rows > threshold, synchronous otherwise
- **Pros:** Hybrid — existing small imports unaffected.
- **Cons:** Two code paths to maintain; partial-failure result cannot be returned for the async path; still requires job-status endpoint for large imports.

### Option 3: Keep synchronous with documented cap ← المختار
- **Pros:** Zero API surface change; all existing tests remain valid; bounded by three overlapping guards (row cap + sentinel + body limit); worst-case latency acceptable for MVP.
- **Cons:** Cannot handle > 1000 rows per call until Queue is added — acceptable for CRM import volumes at MVP launch.

## Rationale

The three overlapping guards (body limit, ParseCsvText sentinel, MAX_IMPORT_ROWS check) make the synchronous approach safe against abuse and OOM. MVP CRM import volumes (initial data loads, day-to-day imports) are well within 1000 rows. The Queue infrastructure (BullMQ/Redis) is already in place from ADR-0007; wiring Import into it is a one-sprint effort when the trigger conditions above are met — not a fundamental architecture change.

## Consequences

### Positive
- Zero API contract change — all callers and tests remain unaffected.
- No Redis dependency for this module (reduces operational surface for MVP).
- Partial-failure result (`{total, created, deduped, failed[]}`) is returned immediately — better UX than polling.

### Negative (Trade-offs)
- Import batches capped at 1000 rows per call. Customers needing larger loads must split their CSV or wait for the async upgrade.
- Worst-case ~5 second response time for 1000-row imports under load — monitored via Prometheus histogram.

### Risks
- Concurrent large imports could saturate DB connections. Mitigated by the shared-pool cap (ADR-0003, max 40 connections) — each import is sequential, not parallel per-row.

## Validation Plan

- **Metric 1:** p95 import latency (Prometheus `http_request_duration_seconds`) < 10 seconds in production.
- **Metric 2:** No customer-reported import failures due to row limit within first 3 months post-launch.
- **Review date:** 2026-09-13 (3 months post-MVP launch).

## References

- `Server/Src/Modules/Import/Import.Service.ts` — synchronous implementation, `MAX_IMPORT_ROWS`.
- `Server/Src/Modules/Import/Import.Schema.ts` — `MAX_IMPORT_ROWS = 1000` constant.
- [ADR-0007](./0007-phasec-realtime-and-queue-infrastructure.md) — BullMQ/Redis queue infrastructure (available when Queue path is needed).
- `.Pm/22-DoD-Gap-Board.md` § Import — Gap #10 source.
