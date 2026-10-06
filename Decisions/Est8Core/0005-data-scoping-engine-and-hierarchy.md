# ADR-0005 — Data scoping engine + brokerage hierarchy (RBAC Phase 2)

- **Status:** Accepted
- **Date:** 2026-06-10
- **Project:** Est8Core
- **Relates / builds on:** [ADR-0004](./0004-rbac-role-model-and-enforcement.md) (route gate), `.Pm/04-DataScoping-Teams-Plan.md` (spec + decisions D1–D8), CLAUDE.md §6

## Context

ADR-0004 added the **route gate** (`RequirePermission`) but explicitly deferred the **record gate**.
So inside a tenant, anyone holding e.g. `leads.view` saw **every** lead — no per-record `own/team/branch`
visibility. The brokerage hierarchy (branch heads, team leaders, agents) was unenforced, lead ownership
was a single nullable column, Teams was a name only, and the secondary surface
(contacts/uploads/notifications/whatsapp/export) was owner-only because no role had its permissions.

## Decision

**1. A cross-cutting Scope Engine** (`Core/Authz/Scope/`) — scoping is a *concern*, not per-module code.
Single source: `SCOPE_MATRIX` + `BuildReadPredicate`/`BuildDeletePredicate` (column-based **and**
correlated `EXISTS` for join-table ownership) + `ResolveReadScope`/`ResolveDeleteScope`. The team-member
lookup is **injected** (`MemberResolver`) so Core never imports Teams. Each entity declares its columns
once via `EntityScopeMeta`; services call one read helper and one delete helper.

**2. Role × scope matrix** (uniform across every scoped entity): `owner = all` (`*` bypasses, no
predicate), `branch_manager = branch`, `team_leader = team`, `sales_agent = own`, `viewer = branch`
(read-only). **D1 fail-closed:** a level lacking its column/value → matches nothing. Out-of-scope on
get/update/delete → **404** (no existence leak), not 403.

**3. Agent delete restriction:** an `own`-level caller may DELETE an *important* record
(leads/deals/properties/contacts) only when `createdBy = self`; higher roles delete by authority within
scope. (Read-scope ≠ delete-scope: an agent can read a record assigned to them but not delete it.)

**4. Teams** (`teams` + `team_members`): **D5** one team per user (`UNIQUE(tenant_id,user_id)`),
**D2** deleting a team with members is refused (409). `teamId` is resolved at login/refresh into the JWT;
team scope = `ownCols/assignees IN (team member ids)`.

**5. Lead ownership = `lead_assignees` join** (many assignees, `is_primary`, `assigned_by`); the creator
becomes primary automatically. Replaces a single `assignedTo` column (a lead is worked by several people).

**6. D6 — branch_manager manages own-branch users:** granted `users.create/update/delete`, enforced in
`Users.Controller` with branch confinement (out-of-branch → 404), a role ceiling (may assign only
`sales_agent/team_leader/viewer`), and peer/superior protection (can't touch an owner or another manager).
`CreateUser` forces the new user's branch to the manager's.

**7. D7 — properties = branch inventory:** `properties.view` for all branch staff (needed by the deal
flow), `properties.*` for branch_manager (+owner). `CreateProperty` forces the caller's branch for
non-owners. Property scope has no per-agent ownership (own/team degrade to branch).

**8. D8 — secondary modules granted + scoped:** Contacts inherit the **parent lead's** scope
(`AssertLeadInScope`); Uploads are own (`userId`); Notifications + WhatsApp are personal by construction
(queries already filter by the caller). Granted to operational roles in the seeder. **Export stays
owner-only**, and its `FetchRows` exports all tenant rows ignoring scope — safe only while export is
owner-only; row-level scoping is required before granting export to any lower role (tracked with the
Export async-queue rework).

## Consequences

- Per-record visibility + write authorization are enforced tenant-wide; the brokerage hierarchy is real.
- Verified by ~338 integration/unit tests (negative scope per role × entity, delete restriction, Teams
  D2/D5, branch confinement + role ceiling, parent-scoped contacts, own-scoped uploads).
- Distinguishes **403 (missing permission, route gate)** from **404 (out of scope, record gate)**.
- Custom roles get scope for free: an unknown role name falls back to `own` via `SCOPE_MATRIX`.
- **Open follow-up:** Export row-level data scoping (before lowering its permission); tenant-type
  seeder/cascade (Phase 4); custom-roles module (Phase 5).

## Alternatives considered

- **Per-module WHERE logic** — rejected: scoping is cross-cutting; N copies drift. One engine, one matrix.
- **`team_id` column on every entity** — rejected: avoided a column per table by resolving team membership
  to a set of user ids and reusing the existing ownership columns (`ownCols IN memberIds`).
- **Single `assignedTo` column on leads** — rejected: a lead is genuinely worked by several people; a join
  table (`lead_assignees`) with a primary flag models reality and scales to distribution rules later.
- **403 for out-of-scope reads** — rejected: leaks existence; record gate returns 404.
