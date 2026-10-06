# ADR-0003: DB Connection Pooling — Shared Pool + SET LOCAL search_path

- **Status:** Accepted (Phase 2 implemented). Supersedes the brief Phase-1 LRU interim (built then removed the same day).
- **Date:** 2026-06-10
- **Deciders:** Sabry
- **Project:** Est8Core
- **Tags:** architecture, database, multi-tenancy, scalability, observability, tenant-isolation

## Outcome (2026-06-10)

Phase 1 (bounded LRU + monitoring) was built first, then — once it was clear the LRU only *measured/soft-limited* and didn't bound connections below `max_connections` (default 50 pools × 10 = 500 > 100) — Sabry chose to go straight to the permanent fix. **Phase 2 (single shared pool + per-operation `SET LOCAL search_path`) is now the implementation.** The LRU pool cache was removed; the monitoring (GetPoolStats / GetDbConnectionStats / DbMonitor / `GET /api/v1/admin/db-stats`) was kept and repointed at the shared pool. A de-risking spike confirmed Drizzle works with the proxy and tenants stay isolated even on a `max:1` pool; a permanent isolation test (`TenantIsolation.Integration.test.ts`) guards it.

How it works: `TenantDb.ts` exposes a `TenantPgClient` implementing the minimal `pg.Pool` surface Drizzle uses (`query`/`connect`). Every standalone statement runs as `BEGIN; SET LOCAL search_path TO "<schema>",public; …; COMMIT`; Drizzle-managed transactions get `SET LOCAL` injected right after Drizzle's `BEGIN`. `SET LOCAL` is transaction-scoped → resets at COMMIT/ROLLBACK → a reused connection can never carry another tenant's search_path. Total connections = `DB_SHARED_POOL_SIZE` (30) + master `DB_POOL_SIZE` (10) ≤ 40, fixed regardless of tenant count.

Accepted cost: a standalone statement now takes ~3 round-trips (BEGIN+SET LOCAL, query, COMMIT) instead of 1 — negligible on a co-located DB, noticeable over a high-latency link.

**Hard-won implementation note (do not regress):** the proxy class name MUST contain "Pool" (it is `TenantPgPool`). Drizzle's node-postgres session picks per-transaction connection handling via `instanceof Pool || constructor.name.includes("Pool")`. With any other name, Drizzle treats the proxy as a single Client and runs every transaction statement through `query()` — each on a fresh auto-committed connection — silently breaking transaction atomicity (FOR UPDATE/row locks never hold). This surfaced as lost updates and a failing logout-race (C2) test; it was invisible to read-only checks. Guards: a FOR UPDATE serialization spike + `TenantConcurrencyLeak`/`TenantIsolation` integration tests (real transactions on a tiny pool). Separately, TOTP verification was given `epochTolerance: 30` (±30s clock-skew tolerance) after Phase 2's added latency exposed strict-window flakiness.

## Context

Schema-per-tenant isolation uses **one `pg.Pool` per tenant schema**, cached in a `Map` and **never evicted** (`Config/Database.ts`). `search_path` is baked into each pool's startup config, permanently binding a pool to one schema.

Risk: total connections scale with concurrently-active tenants × pool size. With `DB_POOL_SIZE=10`, ~10–20 concurrently-active tenants can exhaust PostgreSQL's default `max_connections` (~100), producing connection-wait timeouts (`connectionTimeoutMillis=10s`) and latency spikes. The unbounded `Map` also leaks pool objects. `idleTimeoutMillis=20s` mitigates by closing idle *connections*, so the real ceiling is concurrent-active load, not total tenant count — but it is still a hard scaling ceiling. Newly-added per-request work (FOR UPDATE transactions, the L2 epoch read) holds connections marginally longer.

There is no production load data yet (dev DB, test tenants), so a blind full re-architecture is premature.

## Decision

**Two phases.**

- **Phase 1 (now):** Add observability + bound the pool cache.
  - `TenantPoolCache` — bounded LRU (`DB_MAX_TENANT_POOLS`, default 50). Access moves a pool to MRU; eviction closes the oldest pool that is **idle and stale** (no in-use connections, untouched ≥ `minIdleMs`); if all are busy it allows temporary over-cap rather than killing an active pool.
  - `GetPoolStats()` (pool internals) + `GetDbConnectionStats()` (pg_stat_activity vs `max_connections`).
  - `StartDbMonitor()` — periodic sampler that emits a high-risk infra log (→ combined-high-errors.jsonl) when requests are waiting or connections exceed `DB_SATURATION_PCT` (default 80%).
  - Admin endpoint `GET /api/v1/admin/db-stats`.

- **Phase 2 (when measured pressure / before real scale):** Single shared pool + `SET LOCAL search_path` per transaction — decouples connection count from tenant count entirely.

## Considered Options

### Phase-2 candidates (deferred)
- **Shared pool + `SET LOCAL search_path`** ← chosen for Phase 2. Bounds connections to one pool. `SET LOCAL` auto-resets at COMMIT → no cross-tenant `search_path` leak. Cost: every tenant op must run inside a transaction (broad refactor) + strict tenant-isolation tests.
- **PgBouncer (transaction pooling)** — deferred. Breaks per-pool `search_path` (startup param shared across multiplexed server connections) → requires the `SET LOCAL` refactor anyway, plus new infra to deploy/monitor.

### Phase-1 (chosen now)
- **Bounded LRU + monitoring** — caps pool objects, gives visibility, low risk, reversible, no per-query refactor. Measure before re-architecting.

## Rationale

"How will connections behave and how do we monitor it?" is answered directly by Phase 1 without the risk of the shared-pool refactor — whose failure mode is **cross-tenant data leakage**, the worst possible bug in a multi-tenant SaaS. Measuring real usage first lets the Phase-2 trigger be data-driven, not speculative.

## Consequences

### Positive
- ✅ Pool-object growth bounded; idle/stale pools reclaimed
- ✅ Live visibility (endpoint + auto high-risk alert in logs)
- ✅ No risky per-query refactor; fully reversible

### Negative (accepted)
- ⚠️ Connection ceiling is *raised/observed*, not eliminated — Phase 2 is the real fix
- ⚠️ Narrow eviction edge: a request idle between queries while many other tenants churn could see its pool evicted (mitigated by MRU-on-access + `minIdleMs` grace; eliminated by Phase 2)

### Validation Plan
- **Trigger for Phase 2:** sustained `db-monitor` high-risk alerts (waiting > 0 or pct ≥ threshold) under real load.
- **Test:** `TenantPoolCache.test.ts` (LRU/eviction/busy-guard), `DbStats.Integration.test.ts` (pg_stat_activity readout).

## References
- `Config/TenantPoolCache.ts`, `Config/Database.ts` (GetPoolStats/GetDbConnectionStats), `Config/DbMonitor.ts`
- Admin endpoint: `Modules/Admin/Admin.Routes.ts` → `/db-stats`
- Related: ADR-0002 (migration runner)
