# h02 verification

Workspaces built with `/home/user/bench2/tools/build_session.sh /home/user/bench2-new/h02 <kind> <dest>` (no `reference/broken`: broken = base).
`bun run typecheck` passes in broken, fixed and alt. Hidden tests run with `session_check.check`; fixed and alt were run 3 times each, all green every time.

| Request | Tests | broken | fixed | alt | Trap |
|---|---|---|---|---|---|
| r01 plans + subscribe | 4 | 0/4 | 4/4 | 4/4 | double-click subscribe, foreign customer/plan → 404, huge ids / 5e9 price never 500 |
| r02 invoices + owner money rule | 4 | 0/4 | 4/4 | 4/4 | leftover on last invoice of the cycle, catch-up of missed months, parallel Billing/Run |
| r03 pay invoice | 3 | 0/3 | 3/3 | 3/3 | triple parallel pay → one success, foreign invoice → 404 |
| r04 coupons | 3 | 0/3 | 3/3 | 3/3 | floor in customer's favour without float drift, redemption limit in parallel |
| r05 upgrade proration | 3 | 0/3 | 3/3 | 3/3 | rule recall: 4666 / 2035 integers (not rounded, not strings) |
| r06 refunds | 4 | 0/4 | 4/4 | 4/4 | cumulative + parallel over-refund, cap = discounted / proration amount paid |
| r07 split invoice | 3 | 0/3 | 3/3 | 3/3 | rule recall: leftover on LAST part; billing must not re-issue the voided period |
| r08 daily revenue | 3 | 0/3 | 3/3 | 3/3 | Cairo day, Now()-based timestamps, double pay counted once, per company |

## Mutation checks (not shipped)
- Naive choices (pay without transaction, remainder on first parts, `Math.round` proration, `floor(A*(1-P/100))`, UTC day): fails r02, r03, r04, r05, r06, r07, r08.
- Fixed with every transaction removed and no unique indexes: fails exactly the race tests in r01, r02, r03, r04, r06 (and r08 via the double pay).

## Alt design
`reference/fixed`: one `Billing` module on Drizzle; `bigint` columns; invoices keep `AmountPaid`/`AmountRefunded` counters; races handled by `Db.transaction` + `SELECT … FOR UPDATE`; partial unique indexes back subscriptions and period invoices; report uses SQL `AT TIME ZONE 'Africa/Cairo'`.

`reference/alt`: split across `Subscriptions` and `Invoices` modules using raw SQL on the PGlite client; `integer` columns with tighter zod bounds (5e9 price → 400, which the test allows); invoices store gross + discount and paid/refunded amounts are derived from one `MoneyMovements` ledger (In/Out); races handled by conditional single statements (`UPDATE … WHERE State='Open' RETURNING`, `Used < MaxRedemptions`, guarded `INSERT … SELECT … WHERE balance >= amount`, `ON CONFLICT DO NOTHING`); Cairo day bounds computed in JS with `Intl`, two migrations instead of one.

## Fairness notes
- Every creating POST accepts `[200, 201]`; ambiguous statuses are sets (`[400, 404]` for huge ids, `[400, 404, 409]` for a foreign/unknown coupon code, `[404, 409]` for paying a voided invoice, `[400, 409]` for a 1e15 refund).
- Tests read only fields the prompts define (`Price`, `IntervalMonths`, `Status`, `StartDate`, `PeriodStart/End`, `Amount`, `Discount`, `AmountPaid`, `AmountRefunded`, `DueDate`, `Invoices`, `Subscription`, `Invoice`, `Collected/Refunded/Net`). No table or column names.
- `GET /Plans` and `GET /Subscriptions/:Id/Invoices` accept a bare array or `{ Items }`; the invoice list is sorted by `PeriodStart, Id` in the test helper.
- The clock is moved with `setSystemTime`; AGENTS.md says business time comes from `Now()`.
