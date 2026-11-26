# Sessions verification

Each session is 5 requests in one conversation on the base codebase. `reference/broken` is the starting state, `reference/fixed` the state after all requests, `reference/alt` a second, structurally different correct solution. Every request's hidden tests (`hidden/rNN/`) run together against each state with `tools/session_check.py`; `tools/verify_sessions.py` regenerates this table. All broken, fixed and alt workspaces pass `bun run typecheck`.

| Session | Request | Broken | Fixed | Alt | OK |
|---|---|---|---|---|---|
| s01 | r01 | 0/3 | 3/3 | 3/3 | yes |
| s01 | r02 | 0/4 | 4/4 | 4/4 | yes |
| s01 | r03 | 0/1 | 1/1 | 1/1 | yes |
| s01 | r04 | 0/2 | 2/2 | 2/2 | yes |
| s01 | r05 | 0/2 | 2/2 | 2/2 | yes |
| s02 | r01 | 1/4 | 4/4 | 4/4 | yes |
| s02 | r02 | 1/2 | 2/2 | 2/2 | yes |
| s02 | r03 | 1/2 | 2/2 | 2/2 | yes |
| s02 | r04 | 0/2 | 2/2 | 2/2 | yes |
| s02 | r05 | 0/3 | 3/3 | 3/3 | yes |
| s03 | r01 | 0/4 | 4/4 | 4/4 | yes |
| s03 | r02 | 0/4 | 4/4 | 4/4 | yes |
| s03 | r03 | 1/2 | 2/2 | 2/2 | yes |
| s03 | r04 | 0/2 | 2/2 | 2/2 | yes |
| s03 | r05 | 0/2 | 2/2 | 2/2 | yes |
| s04 | r01 | 3/4 | 4/4 | 4/4 | yes |
| s04 | r02 | 0/2 | 2/2 | 2/2 | yes |
| s04 | r03 | 0/2 | 2/2 | 2/2 | yes |
| s04 | r04 | 0/1 | 1/1 | 1/1 | yes |
| s04 | r05 | 1/3 | 3/3 | 3/3 | yes |
| s05 | r01 | 1/3 | 3/3 | 3/3 | yes |
| s05 | r02 | 0/3 | 3/3 | 3/3 | yes |
| s05 | r03 | 1/2 | 2/2 | 2/2 | yes |
| s05 | r04 | 0/1 | 1/1 | 1/1 | yes |
| s05 | r05 | 0/2 | 2/2 | 2/2 | yes |
| s06 | r01 | 0/4 | 4/4 | 4/4 | yes |
| s06 | r02 | 0/3 | 3/3 | 3/3 | yes |
| s06 | r03 | 0/1 | 1/1 | 1/1 | yes |
| s06 | r04 | 0/2 | 2/2 | 2/2 | yes |
| s06 | r05 | 0/2 | 2/2 | 2/2 | yes |

## Alt designs

| Session | Fixed | Alt |
|---|---|---|
| s01 gift cards | `GiftCards.Balance` column with a guarded update | ledger table `GiftCardMoves`, balance = sum, card row locked |
| s02 purchasing | `PurchaseOrderItems.ReceivedQuantity` column, legacy rows backfilled by migration | `PurchaseReceiptLines` table, legacy received orders treated as full at read time |
| s03 installments | `Installments` table, one row per installment | one `InstallmentPlans` row per order with a jsonb schedule |
| s04 SMS | background send after commit, `ReminderLog(OrderId, Day)` unique claim | transactional outbox table, `Orders.LastReminderDay` conditional claim |
| s05 pricing | `PriceChanges` (old, new) rows | `PriceVersions` with history derived by `lag()` |
| s06 cash drawer | `Payments.ShiftId` set at payment time, `CashOuts` table | `Payments.TakenBy` plus shift time windows, `DrawerMoves` ledger |

## Smoke run (no plugin)

`tools/run_session.py s01 /tmp/claude-0/smoke_s01 --model sonnet --max-budget-usd 0.13`, no `--plugin-dir`.

- The runner sealed `reference/fixed`, `reference/alt` and `hidden` of all six sessions into `/root/.bench2-sealed` and restored them afterwards.
- The init event listed only built-in plugins (`--setting-sources project,local`), so the user's own plugins did not load.
- `claude -p` for r01, then `--resume <session id>` for r02 to r05, all under one session id.
- `/compact` sent as its own resumed prompt after r02 and r04; both streams carry a `compact_boundary` event (manual trigger, 32k to 7k tokens after r02). `compactions: 2` of 2.
- Hidden results: r01 3/3, r02 4/4, r03 1/1, r04 2/2, r05 2/2. Sonnet without a plugin solved s01 completely, even though the per-call budget cap stopped r01 and r03 early (exit code 1).
- Cost: $0.68 in total. The CLI reports `total_cost_usd` cumulatively for a resumed session; the runner now records per-turn deltas (the first draft summed them and printed $2.92).
- `leak: false`. The workspace and streams were deleted afterwards.
