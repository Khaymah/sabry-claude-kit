# ADR-0006 — Phase 4: deal-close cascade, secure branch binding, tenant-type hardening + uniform NOT NULL

- **Status:** Accepted
- **Date:** 2026-06-11
- **Project:** Est8Core
- **Relates / builds on:** [ADR-0005](./0005-data-scoping-engine-and-hierarchy.md) (scope engine), `.Pm/06-TenantType-Cascade-Plan.md` (spec + §11 security revision), `.Pm/02` §2 Phase 4

## Context

A discovery sweep showed most of "tenant-type onboarding" (Phase 4) was already shipped: `tenants.type`
exists and the registration seeder provisions a default branch + roles + lookup data and links the owner.
Three real gaps remained — **deal-close had no cascade**, **`Deals.branchId` was hard-required** (the
individual-broker journey was only half-fixed), and **`tenants.type` was nullable/unconstrained**.

Implementing the branchId fix surfaced a **security finding** (Cyber-Security review, now paired with all
engineering): trusting a client-supplied `branchId` for non-owners is a **cross-branch injection** hole —
an agent could file a record into a branch they don't belong to, defeating the Phase-2 scope boundary.
Sabry's architectural direction: data must be **branch-bound mandatorily**, and every tenant (even the
individual broker) gets a branch **and a team** auto-seeded, so the structure is uniform and the
individual→company upgrade has no edge cases.

## Decision

**1. Deal-close cascade (atomic).** When `UpdateDeal` transitions a deal to a terminal status, it cascades
inside **one tenant DB transaction** (`GetTenantDb(...).transaction`, safe under the shared-pool +
`SET search_path` model): `closed_won` → lead `won`, property `sold` (purpose `sale`) / `rented` (purpose
`rent`); `closed_lost` → lead `lost`, property `available` (freed to inventory). Missing/soft-deleted refs
are skipped silently (`isNull(deletedAt)` predicates).

**2. Deal lock.** A deal already `closed_won`/`closed_lost` rejects **any** update with **409
`DEAL_LOCKED`** (evaluated on the stored status, so the first close is allowed, re-edits refused). An
explicit guarded `reopen` is deferred.

**3. Secure branch binding (the security core).** A single source — `Core/Authz/Scope/ResolveWriteBranch`:
non-owners are **confined to their own branch** (`Ctx.BranchId`, request input **ignored**); the owner
(`*`) may file under any branch (`Input.branchId ?? Ctx.BranchId`). Applied to every write —
`CreateDeal`/`CreateProperty`/`CreateLead` services + `CreateUser` controller. This **closes the
cross-branch injection hole**: an agent can no longer choose a foreign branch. A `BRANCH_REQUIRED` (400/Err)
guard gives a clean error instead of a raw NOT-NULL violation. `CreateDealSchema.branchId` became optional
(resolved server-side). *(Security note: the field being optional + server-forced is **safer** than
"required + trust client".)*

**4. Default team seeding.** `SeedTenantDefaults` seeds a default team in the default branch; `Register`
makes the owner its **leader + member**, so `team_id` flows into the JWT and team-level scoping has data
from day one — uniform for both tenant types. (Test fixtures seed a default branch + assign the owner; they
do **not** seed the team, to avoid the one-team-per-user (D5) conflict in Teams tests.)

**5. Tenant-type hardening.** Master migration `master/0002`: backfill NULL/invalid → `brokerage_company`,
then `SET NOT NULL` + `DEFAULT` + `CHECK (type IN (...))`. Model gains `.notNull().default()`.

**6. Uniform branch NOT NULL.** `leads`/`properties`/`users.branch_id` are now `NOT NULL` (deals/teams
already were). New tenants get it from the appended `ALTER ... SET NOT NULL` in `tenant_schema.sql`;
existing tenants via `tenant/0006` (a **resilient DO block**: backfill to the first branch then SET NOT
NULL; if a legacy tenant has no branch at all, skip rather than fail the run). PG accepts `SET NOT NULL`
alongside the existing `ON DELETE SET NULL` FKs (verified), so no FK swap was needed for valid DDL.

## Consequences

- The brokerage journey completes in one operation; the individual-broker deal-close works end-to-end with
  no manual branch lookup; the data model is uniformly branch-bound.
- **Security:** cross-branch injection is closed tenant-wide; branch (a scope boundary) is server-enforced
  on every write, not client-trusted.
- A **branchless user can no longer exist** (`users.branch_id` NOT NULL), so the `BRANCH_REQUIRED` guard is
  now defense-in-depth (unreachable via normal user creation) — its API test was removed.
- **Behavior change:** hard-deleting a branch that still has leads/properties/users is now **blocked** (the
  `ON DELETE SET NULL` can't null a NOT NULL column) instead of orphaning them — safer, but the raw FK
  error should be cleaned to `ON DELETE RESTRICT` + a friendly message (backlog).
- Verified by **346** integration/unit tests (cascade per outcome, lock, secure derivation incl. a
  no-foreign-injection test, type constraints, uniform NOT NULL); migration applied + asserted on dev;
  typecheck clean. Cost was lower than estimated — Auth uses its own test schema, so ~7 insert fixes, not 18.
- **Open follow-up (backlog):** FK `ON DELETE RESTRICT` + friendly branch-delete error; guarded
  `deals.reopen` (cascade reversal); `status`↔`stage` sync; commission/payout entity.

## Alternatives considered

- **Soft branch fallback (`Input.branchId ?? Ctx.BranchId` for everyone)** — rejected: trusts client
  branchId for non-owners = cross-branch injection. The secure derivation forces the caller's branch.
- **`branchId` required in the API** — rejected: requiring a field the server then ignores for non-owners
  is incoherent and no safer; optional + server-forced is cleaner and more secure.
- **Non-transactional cascade** — rejected: a mid-cascade failure would leave the deal closed but the
  property/lead stale; the tenant pool supports real transactions.
- **Swap FKs to `ON DELETE RESTRICT` now** — deferred: PG allows NOT NULL with the existing SET NULL FK, so
  enforcement landed without the larger FK migration; the cleaner RESTRICT is tracked.
- **Prune hierarchy roles for the individual broker** — rejected: keep the seed uniform so an upgrade to a
  company is seamless.
