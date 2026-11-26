# h03 verification

Built with `/home/user/bench2/tools/build_session.sh` and checked with `session_check.check` (hidden tests of all 8 requests against the final workspace). `bun run typecheck` passes in all three workspaces.

| Request | Tests | broken | fixed | alt |
|---|---|---|---|---|
| r01 branches, legacy -> main branch, staff scoping | 4 | 0/4 | 4/4 | 4/4 |
| r02 BranchManager role | 4 | 0/4 | 4/4 | 4/4 |
| r03 transfers + history | 4 | 0/4 | 4/4 | 4/4 |
| r04 deactivate / activate sessions | 4 | 0/4 | 4/4 | 4/4 |
| r05 per-branch report | 4 | 0/4 | 4/4 | 4/4 |
| r06 audit log | 4 | 0/4 | 4/4 | 4/4 |
| r07 Cashier role + Pay | 4 | 0/4 | 4/4 | 4/4 |
| r08 close branch | 4 | 0/4 | 4/4 | 4/4 |

fixed and alt were each run 3 times with identical results.

The starting state (`reference/broken`) is the base plus a 30 s session cache in `RequireAuth` (a plausible perf shortcut). It makes deactivation and transfers stale unless the agent notices it.

## Trap checks (mutants of fixed)
| Mutant | Fails |
|---|---|
| keep the 30 s auth cache | r03 x2, r04 x3, r08 x1 |
| transfer without a transaction | r03 race |
| transfer and close both without a transaction | r03 race, r08 race |
| deactivate without revoking sessions | r04 (reactivation revives old token) |
| Cashier treated as company-wide | r07 x3, r08 x1 |
| report not branch-scoped | r05 x2 |
| audit log not branch-scoped | r06 x1 |
| Pay not branch-scoped | r07 x1 |
| ids not bounded to int4 (huge id -> 500) | one test in every request |
| legacy staff not moved to main branch | r01, r04 |

## Alt design
- Branch membership lives in a temporal `BranchMemberships` table (one open row per user, enforced by a partial unique index). No `Users.BranchId`. Transfer history is derived from consecutive memberships.
- Legacy orders and expenses keep `BranchId = NULL`, which means "main branch"; scoping uses `BranchId = main OR NULL` and responses map NULL to the main branch id. No backfill.
- Session revocation uses `Users.SessionFloor` (sessions with a lower id are dead) instead of deleting sessions.
- Different but allowed status choices: a scoped user's foreign `BranchId` is ignored (written to their own branch) instead of 403, another branch's order is 403 instead of 404, bad path ids are 400 instead of 404, a manager's report for another branch returns their own branch, Activate answers 201, and moving someone to the branch they are already in does nothing.
- The report is aggregated in JS instead of SQL `GROUP BY`. The main branch is created lazily in auth for companies seeded after the migration.
