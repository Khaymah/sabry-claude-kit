# ADR-0004 — RBAC: canonical roles + permission enforcement

- **Status:** Accepted
- **Date:** 2026-06-10
- **Project:** Est8Core
- **Supersedes/relates:** CLAUDE.md §6 (RBAC gap), `.Pm/02-RBAC-Authorization-Plan.md`

## Context

Inside any tenant the system authenticated *who you are* (valid JWT) but never *what you may do*:
every tenant user was effectively admin. Concrete holes: a self-promotion vuln (`PUT /users/:id
{role}`), no authorization on any tenant route, and a role-naming inconsistency — Tenants seeded
`owner` while the Users module's enum/guards still used `admin`/`manager`.

## Decision

**1. Canonical tenant roles** (distinct from the platform `admin_users` roles): `owner`,
`branch_manager`, `team_leader`, `sales_agent`, `viewer`. Legacy values are migrated, not aliased
(`admin → owner`, `manager → branch_manager`) via `tenant/0003_standardize_roles.sql`.

**2. Permissions are data, seeded per tenant.** The `roles` table (already seeded by
`Tenants.Seeder`) holds each role's `permissions` (jsonb `string[]`): `owner → ["*"]`,
`branch_manager → ["leads.*","deals.*","users.view","branches.view","reports.view"]`, etc. At login
the user's role permissions are resolved from that table and injected into the JWT `permissions`
claim. This is the single source of truth and lets custom roles (Phase 5) work without code changes.

**3. Two-gate enforcement** (Policy-class model, per the plan):
- Route gate — `RequirePermission("resource.action")` middleware, fail-closed, with `*` and
  `resource.*` wildcard matching (`Core/Authz/Permissions.ts`).
- Record gate — per-record `own/team/branch` checks in services (Phase 2, not yet built).

**4. Lockout prevention:** the last active `owner` can't be demoted, deactivated, or deleted.

## Consequences

- Closes the self-promotion vuln and gives every tenant route an explicit permission.
- Roles without seeded permissions for a resource (uploads/whatsapp/notifications/export) are
  currently owner-only — acceptable for Phase 1; refine role permission sets later.
- Tests that hit guarded routes must give their user permissions: login-based tests call
  `SeedTenantRoles(schema, tenantId)`; hand-crafted-token tests put `permissions: ["*"]` in the token.
- **Not yet done (tracked):** data scoping (Phase 2), Teams + lead assignment (Phase 3), tenant-type
  seeder/cascade (Phase 4), custom-roles module (Phase 5).

## Alternatives considered

- **Static role→permission map in code** — rejected: the `roles` table is already seeded and is the
  natural home; a code map would duplicate it and block custom roles.
- **Middleware-only (no record gate)** — insufficient for own/team/branch scoping; deferred record
  gate to Phase 2 but kept the Policy-class structure.
- **Keep `admin`/`manager` as aliases** — rejected: permanent dual-naming / tech debt; a one-shot
  data migration is cleaner and Tenants already emits `owner`.
