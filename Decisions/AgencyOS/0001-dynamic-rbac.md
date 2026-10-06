# ADR-0001 — Dynamic RBAC (Custom Roles) for Agency OS

**Status:** PROPOSED — awaiting Sabry approval before implementation  
**Date:** 2026-06-03  
**Author:** Engineering (Claude)  
**Related:** V3-PLAN §6 · S12 Roles screen · `Core/Rbac/Permissions.ts`

---

## Context

Agency OS currently has **5 fixed system roles** (Owner / Admin / Manager / Member / Client)
defined statically in `Core/Rbac/Permissions.ts` and enforced at two layers:

1. **App layer:** `RequirePermission(EPermission.X)` middleware on every route
2. **DB layer:** Postgres RLS with `agencyos_app` restricted role + `app.org_id` GUC

The V3-PLAN requires **custom/dynamic roles** (S12): users can create org-specific roles with
configurable permissions and assign them to members.

This decision records the approach that keeps RLS isolation green.

---

## Decision

### 1. What changes (custom layer — additive)

- New tables (org-scoped, RLS):
  - `CustomRoles`: `OrgId`, `Name`, `Slug`, `IsSystemRole: bool` (for the 5 built-ins)
  - `CustomRolePermissions`: `RoleId`, `PermissionKey: text`
  - `MemberRoleOverride`: optional — allows per-member custom role assignment
- The **5 system roles stay immutable** (`IsSystemRole = true`), seeded per org.
  They cannot be deleted or have permissions removed below their current set.

### 2. What does NOT change (security invariants)

- **RLS is NOT touched.** All org isolation stays via `OrgId = app.org_id`. Custom roles
  add an app-layer authz check; they never bypass the DB-layer tenant boundary.
- **`agencyos_app` restricted role stays unchanged.** No RLS bypass.
- **`Client` role stays portal-only.** Custom roles are Team-member roles only.
- **No privilege escalation:** a user can only grant a permission they themselves hold.
  Implemented via a server-side `CanGrant(ActorPermissions, GrantedPermissions)` check.

### 3. Enforcement strategy

```
Request → RequireAuth → RequireOrg → LoadOrgRole (reads CustomRoles) → RequirePermission
```

`LoadOrgRole` is updated to:
1. If the member has a `CustomRole`, load its `PermissionKey` set from `CustomRolePermissions`.
2. If not, fall back to the static `ROLE_PERMISSIONS[RoleKey]` map (existing behavior).
3. Attach the resolved permission set to `c.get("Permissions")` for `RequirePermission` to check.

`RequirePermission` already checks `c.get("Auth").RoleKey` — it gets upgraded to check
the permission set directly. **No existing route logic changes.**

### 4. VerifyIsolation gate

`bun Src/Database/VerifyIsolation.ts` MUST pass after every schema migration.
Custom roles tables are org-scoped; the test verifies cross-org isolation.
If VerifyIsolation turns red at any point → **stop, do not merge.**

### 5. Billing permission row (§7 open question)

The roles matrix in S12 has a "Billing" permission row. Billing is cancelled (Sabry decision).
**Proposed:** keep "Billing" as an abstract permission key that always resolves to `false`
for all roles (disabled without removing the matrix column). Remove it from UI display.
→ **Requires Sabry confirmation** (bundled with this ADR approval).

### 6. What is NOT in scope now

- Per-resource permissions (e.g. "can only edit Projects of Branch X")
- Custom permissions with granularity beyond the current EPermission enum
- UI for managing CustomRoles (S12 screen — builds after ADR is approved)

---

## Consequences

- **If approved:** implement in order: schema → LoadOrgRole upgrade → S12 UI →
  VerifyIsolation → Sabry review
- **If rejected:** keep 5 fixed roles, mark S12 as deferred
- **Security:** the two-layer model (app-layer authz + RLS tenant isolation) is preserved;
  a bug in custom-role logic at most exposes wrong-permission access WITHIN the org —
  cross-org data leakage is still blocked by RLS independent of this feature

---

## Approval required from Sabry

1. **Overall approach:** additive custom roles on top of system roles, RLS untouched ✅/?
2. **Billing row:** keep as `false` placeholder or remove entirely?
3. **Privilege escalation rule:** "cannot grant what you don't hold" — is this the right model?
