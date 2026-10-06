# ADR 0001 — Admin RBAC: static roles-as-keys + per-client JSON permissions

- **Project:** AdhamFathallah (real-estate backend, Node + forked Sequelize + MariaDB)
- **Status:** Accepted
- **Date:** 2026-06-19
- **Deciders:** Sabry

## Context
Adham needed an admin roles/permissions system "like Master but simpler." Constraints set by Sabry across the discussion:
- Reuse the existing `Clients` table for both users and admins (admin = Client with `ClientRoleId ∈ ADMIN_ROLE_IDS`). No separate `Admins` table.
- No complex permissions table like Master's.
- Permissions must be **per-admin** and **editable at runtime** (not fully static).
- **Decouple Adham from Master's shared `Roles` table**; the role should be "just a Key."

The Client model was coupled to Master's `Roles` table via three `ClientRole` literal subqueries (defaultScope, WitchBlackList, defaultScopes helper). All `ClientRole` consumers were traced: every one reads only `ClientRole.RoleId` (IsAdmin, Permissions, AdminAuthRoutes); `PaymentsRoutes` reads `ClientRole.RolePermission` which never existed (already undefined). No code compares `RoleKey`/`RoleName`.

## Decision
1. **Roles = static key map** in `_Server/Config/Roles.js` (`{id: {RoleId, RoleKey, RoleName}}`). Removed the 3 `ClientRole` Roles-table subqueries from the Client model; `ProcessData.Client` now builds `ClientRole = Roles.Get(ClientRoleId)` (shape preserved: `{RoleId, RoleKey}`), keeping all consumers working. **Adham no longer joins Master's `Roles` table.**
2. **Permissions = static defaults + per-admin override.** Static role→permissions map in `_Server/Config/Permissions.js`, keyed `resource.action` with wildcards (`*`, `resource.*`). Per-admin override stored in a new `Clients.ClientPermissions` JSON column (migration 029, idempotent). `Permissions.Can(client, key)` is **sync**, reading effective = `client.ClientPermissions` (if non-empty array) **else** the role default. No cache/store needed — permissions travel with the authenticated `req.Client`.
3. **Runtime management** via `/api/v3/admin/permissions` (catalog / list admins / PUT set / POST reset), guarded by `permissions.manage` (Administrator role 1 only).
4. **Notes (Tracker)** feature built on top: `notes.viewAll` → all; else assigned-only via `NoteSupport`. Role distribution: 1=all, 2=CRUD+viewAll, 3=create/update assigned-only.

## Consequences
- ✅ Simple, no joins, no permissions/admins tables, runtime-editable, no cache (override on `req.Client`).
- ⚠️ **`ClientPermissions` is added to the SHARED `Clients` table.** Because the Client model now SELECTs it, **migration 029 MUST run before any Client query** (every auth). `AUTO_MIGRATE=true` runs it on startup/restart. Column is additive/nullable → safe for Master.
- ⚠️ Per-admin override **replaces** (does not merge) the role default.
- ⚠️ Mixed id-space: legacy Master-created Tracker notes (`NoteCreatedBy = Admins.UserId`) won't enrich against `Clients`.
- ⚠️ `ADMIN_ROLE_IDS` default `"1,5"`; role 5 has no entry in the permissions map → a role-5 "admin" passes the auth gate but `Can()` denies everything. Tune `ADMIN_ROLE_IDS` / the map in production.

## Alternatives rejected
- Separate `RolePermissions` table + cache → more moving parts; Sabry wanted simpler.
- Permissions blob in `AppSettings` → coarser, all roles in one record.
- Keep Master `Roles` join → the coupling we were removing.

## Verified
RBAC engine (17 assertions: wildcards, per-client override replaces default, role-as-key) and `ProcessData.Client` static-role build + permissions parse (7 assertions) — all pass with no DB. NOT yet runtime-tested: live Client queries with the new column, Note CRUD, management endpoints, `/admin` socket Note emit (need migration 029 applied + running server).
