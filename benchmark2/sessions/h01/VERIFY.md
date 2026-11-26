# h01 verification

Workspaces built with `/home/user/bench2/tools/build_session.sh /home/user/bench2-new/h01 <kind> <dest>`; `bun run typecheck` passes for broken, fixed and alt. Hidden tests run with `session_check.check`.

| Request | Tests | broken | fixed | alt |
|---|---|---|---|---|
| r01 branches + legacy main branch | 3 | 0/3 | 3/3 | 3/3 |
| r02 adjustments | 4 | 0/4 | 4/4 | 4/4 |
| r03 stock report | 2 | 0/2 | 2/2 | 2/2 |
| r04 transfers send/receive | 4 | 0/4 | 4/4 | 4/4 |
| r05 stocktake | 3 | 0/3 | 3/3 | 3/3 |
| r06 transfer cancel | 4 | 0/4 | 4/4 | 4/4 |
| r07 movement ledger | 3 | 0/3 | 3/3 | 3/3 |
| r08 in-transit report | 3 | 0/3 | 3/3 | 3/3 |

`reference/broken` is empty: the starting state is the base.

Extra check (not shipped): a "naive" copy of fixed (read-check-write outside the lock, unbounded zod ints, no legacy data migration, stocktake applied line by line, cancel ignoring the received case, in-transit counting every non-received transfer) failed at least one test in every request except r03 (no naive mutation was applied there; the query-budget test is the r03 trap).

## Alt design

- fixed: `Warehouses` + materialized `WarehouseStock (WarehouseId, ProductId, Quantity CHECK >= 0)` changed by single conditional `UPDATE ... WHERE Quantity + Change >= 0` / upsert statements, a separate `WarehouseMovements` table with stored `Balance`, `Transfers` + `TransferItems` rows, report built from 5 small queries in TypeScript, main branch also created lazily on `GET /Warehouses`, creates answer 201, `GET /Warehouses` returns an array.
- alt: `Stores` + append-only `StockLedger` (no quantity column: stock = `SUM(Delta)`), concurrency through `SELECT ... FOR UPDATE` on the store rows then check-and-append, `StockTransfers` with the lines in a `jsonb` column and a state-guarded `UPDATE`, ledger `Balance` computed with a window function, report as one CTE/JSON query, no lazy main branch, creates answer 200, `GET /Warehouses` returns `{ Items }`, stock lists only non-zero rows, duplicate transfer lines rejected by schema.
