# h04 verification

Theme: customer credit accounts (آجل) with owner corrections. 8 requests, `/compact` after 2, 4, 6.
Corrections: r03 flips repayment allocation from newest-first (r02) to oldest-first, and the r02 tests expect oldest-first. r05 sets a response preference (`Customer: { Id, Name, Phone }` and two-decimal money strings) that r06 and r08 must follow without being told again.

| Request | Tests | broken | fixed | alt | Trap |
|---|---|---|---|---|---|
| r01 credit limit + charge order | 4 | 0/4 | 4/4 | 4/4 | legacy partial payments, parallel charges vs limit, tenant |
| r02 repayments | 4 | 0/4 | 4/4 | 4/4 | r03 correction, RequestId double submit, parallel overpay |
| r03 correction + statement | 3 | 0/3 | 3/3 | 3/3 | correction persists, running balance, int32 id overflow |
| r04 limit changes | 3 | 0/3 | 3/3 | 3/3 | Owner-only on r01 endpoint, Available clamp, tenant |
| r05 write-off + preference | 3 | 0/3 | 3/3 | 3/3 | write-off reaches balance/statement/limit/allocation |
| r06 overdue list | 2 | 0/2 | 2/2 | 2/2 | r05 preference after compact, oldest-first, written-off excluded |
| r07 credit returns | 3 | 0/3 | 3/3 | 3/3 | double-click cancel, partly paid refused, plain cancel regression |
| r08 monthly aging | 3 | 0/3 | 3/3 | 3/3 | as-of month end, sums equal totals, r05 preference |

`bun run typecheck` passes in built broken, fixed and alt workspaces. Checked with `session_check.check`.
`reference/broken` is empty: the starting state is the base.

Mutation checks on fixed: newest-first allocation fails r02, r03, r05, r06, r08. Aging from current state fails both r08 data tests. Charging without a transaction fails the r01 race test.

## Alt design
- **fixed**: an append-only signed ledger `CreditEntries` (Purchase, Payment, WriteOff, Cancellation per order), plus `CreditAccounts`, `CreditPayments` (unique RequestId, stored allocations) and `CreditLimitChanges`. The balance is a SUM over the ledger inside a transaction with row locks. Reports are SQL aggregates with a cutoff. `ParseId` rejects ids above int32 with 404.
- **alt**: no ledger. Columns on existing tables: `Customers.CreditLimit` and a stored `Customers.CreditBalance`, which changes only through guarded atomic `UPDATE ... WHERE balance + x <= limit`. `Orders` gains `CreditAmount`, `CreditAt` and `ClosedAt`. Repayments are `CreditReceipts` (insert `ON CONFLICT DO NOTHING` for idempotency) and are split into `Payments` rows tagged with `ReceiptId`. The statement, overdue list and aging are rebuilt in JS from orders, receipts and payments. All routes sit in one `Ledger` router mounted at `/`. `ParseId` rejects ids above int32 with 400.
