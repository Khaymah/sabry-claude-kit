# ADR-0002: Incremental Per-Tenant-Schema Migration Runner with Journal + Baseline

- **Status:** Accepted
- **Date:** 2026-06-10
- **Deciders:** Sabry
- **Project:** Est8Core
- **Tags:** architecture, database, multi-tenancy, migrations, schema-per-tenant

## Context

Est8Core uses schema-per-tenant isolation. New tenants are provisioned by `ProvisionTenantSchema`, which applies the full snapshot `tenant_schema.sql` **additively** (`CREATE TABLE IF NOT EXISTS`, swallowing 42P07/42710/42723). This is fine for creating a fresh tenant, but it **cannot evolve an already-provisioned schema** — there was no incremental migration path at all.

The gap became a live incident during the A6 work (refresh-token hashing): renaming `token → token_hash` and adding `family_id NOT NULL` in the snapshot + runtime code broke `login`/`refresh` for every tenant provisioned before A6. A DB probe confirmed it was not hypothetical — 3 registered remote tenant schemas still had the old shape and were throwing `undefined_column` on every auth attempt. Every future schema change (Users, Leads, …) would hit the same wall.

## Decision

Ship a **versioned, incremental, per-tenant-schema migration runner** alongside the existing snapshot:

- Incremental migrations live in `Database/Migrations/tenant/NNNN_*.sql`, applied in filename order, split on `--> statement-breakpoint` (same convention as the snapshot).
- Each tenant schema owns a `_migrations(id, applied_at)` **journal** recording what it has run.
- Each migration applies inside **one transaction** (PostgreSQL DDL is transactional) → a failing statement rolls the whole migration back; a schema is never left half-migrated.
- **Baseline:** `ProvisionTenantSchema` stamps every current migration id into a fresh schema's journal after applying the (already-latest) snapshot, so new tenants never re-run a change the snapshot already contains.
- **Fan-out:** `MigrateAllTenants` joins master `tenants` against `information_schema.schemata`, filtering to registered, non-deleted, physically-existing schemas — skipping orphan schemas and dead registrations.
- Exposed as `bun run migrate` (CLI), not auto-run at boot.

## Considered Options

### Option 1: Keep snapshot-only provisioning, fix breakage with one-off manual SQL
- **Pros:** zero new code
- **Cons:** every future schema change repeats the manual scramble; no record of what ran where; error-prone

### Option 2: Adopt drizzle-kit / a heavy migration framework per tenant
- **Pros:** mature tooling
- **Cons:** drizzle-kit targets a single database/schema, not N dynamic tenant schemas; awkward fan-out; heavier than needed

### Option 3: Hand-rolled incremental runner + per-schema journal + baseline ← المختار
- **Pros:** fits schema-per-tenant exactly; transactional; idempotent migrations; minimal deps (pg only); CLI-driven and explicit
- **Cons:** we own it; migration files must be written idempotently by hand

## Rationale

The snapshot answers "provision a NEW tenant at latest"; it structurally cannot answer "evolve an OLD tenant." Those are different problems and need a second mechanism. A per-schema journal (not a master-level one) matches the isolation model — a dropped/recreated schema resets correctly on its own. Baseline-stamping resolves the snapshot-vs-migration overlap cleanly. Keeping it a CLI (not boot-time) avoids slow, partially-failing startups across all tenants.

## Consequences

### Positive
- ✅ Existing tenants can be upgraded without re-provisioning or forced data loss
- ✅ Backfill migrations preserve live data (A6's 0001 hashed the legacy plaintext token in place → sessions survived)
- ✅ Idempotent + transactional + journaled → safe to re-run, auditable per schema
- ✅ New tenants are auto-baselined → no double-apply

### Negative (accepted)
- ⚠️ Migration SQL must be authored idempotently by hand (guards: `IF [NOT] EXISTS`, `DO $$` column checks) — enforced by review + the runner's integration test
- ⚠️ `MigrateAllTenants` is sequential (one schema at a time) — fine at current tenant counts; parallelize later if needed

### Risks
- 🚨 A bad migration could corrupt many tenant schemas — Mitigation: per-migration transaction (auto-rollback), a deterministic integration test that exercises the old→new transform, and CLI-only execution (no silent boot-time apply)

## Validation Plan
- **Test:** `Migrations.Integration.test.ts` proves backfill correctness, idempotency, journaling, and baseline (4/4 passing).
- **Live proof:** `bun run migrate` upgraded 3 real remote tenant schemas; a second run was a clean no-op; shapes re-verified (token_hash + family_id present, plaintext token dropped).
- **Review date:** when tenant count grows enough that sequential fan-out latency matters.

## References
- Runner: `Server/Src/Core/Utils/Migrations.Util.ts`
- First migration: `Server/Src/Database/Migrations/tenant/0001_a6_refresh_token_hashing.sql`
- Baseline wiring: `Server/Src/Core/Utils/Schema.Util.ts`
- Triggered by A6 review finding S1 — see `.Pm/modules/02-Auth.md § مراجعة أمنية A6`
- Related: ADR-0001 (token denylist DB-over-Redis)
