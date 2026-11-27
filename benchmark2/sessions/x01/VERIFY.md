# x01 verification

Theme: staff attendance and payroll on top of companies and users. 8 requests, `/compact` after 2, 4, 6.
Owner rule stated early (r02): lateness rounds UP to a quarter hour, overtime rounds DOWN to a quarter hour; r04 refers back to it ("بقاعدة التقريب بتاعتي") and r07/r05/r06 tests still depend on it after two compactions.
Owner correction (r07): overtime becomes 2x from `2026-04-15` by attendance `Date`; earlier days (all of the r04/r05 March data) must stay 1.5x.

Workspaces built with `/home/user/bench2/tools/build_session.sh /home/user/bench2-new/x01 <kind> <dest>`; `bun run typecheck` passes for broken, fixed and alt. Hidden tests run with `session_check.check`.

| Request | Tests | broken | fixed | alt | Trap |
|---|---|---|---|---|---|
| r01 employees, salary, shift | 3 | 0/3 | 3/3 | 3/3 | legacy users from 0001_Init listed with defaults, users created later too; huge/negative/3-decimal salary and bad HH:MM -> 400; tenant; Owner/Admin |
| r02 check-in / check-out | 4 | 0/4 | 4/4 | 4/4 | Cairo day of check-in (00:55 Cairo dawn shift), shift times in Cairo, night shift past midnight, rounding rule, double tap once, tenant |
| r03 leaves + balance | 3 | 0/3 | 3/3 | 3/3 | parallel requests cannot overdraw 21 days or double-book, Fridays excluded, invalid dates, tenant/huge ids |
| r04 payroll run | 3 | 0/3 | 3/3 | 3/3 | never twice (parallel -> one), attendance month by `Date` (night shift 31 Mar -> 1 Apr stays March, 01:10 Cairo on 1 Apr is April), unpaid leave split across months, annual not deducted, March stays 1.5x after r07 |
| r05 payslip report + Me | 2 | 0/2 | 2/2 | 2/2 | stored payslips survive a later salary edit, TotalNetPay over all pages, query budget at 120 employees, Staff 403, unpaid month 404, tenant |
| r06 cancel leave | 3 | 0/3 | 3/3 | 3/3 | balance restored once on double click, overlap check ignores cancelled, payroll ignores cancelled unpaid leave, leave touching a paid month -> 409, tenant/huge ids |
| r07 overtime 2x from a date | 2 | 0/2 | 2/2 | 2/2 | split by attendance `Date` inside April (night shift 14->15 April stays 1.5x), earlier months unchanged, rounding still applied |
| r08 void + re-run | 3 | 0/3 | 3/3 | 3/3 | live-run uniqueness after void (parallel re-runs -> one), double void -> one 200, voided run hidden from report/Me, r06 paid-month check ignores voided runs, Owner only, tenant |

`reference/broken` = `Src/Lib/Validate.ts` with `ParseId` bounded to int32 (same overlay as h01's verification workspaces); otherwise the base.

Naive variant (not shipped; a copy of fixed with: no legacy backfill + inner join listing, unbounded salary regex, UTC day and UTC shift times, select-then-insert check-in without unique indexes, leave check-then-insert outside a transaction, overlap counting cancelled leaves, payroll "already paid" by select over all runs outside a transaction, payroll counting cancelled leaves, 2x cutoff by check-out timestamp, report reading the live salary, report/Me picking any run): r01 0/3, r02 1/4, r03 2/3, r04 1/3, r05 0/2, r06 1/3, r07 0/2, r08 0/3 — every request fails at least one test.

Single-mutation checks on fixed (each alone): UTC day -> r02, r04; UTC shift times -> r02, r04, r05, r07; night shift without +1 day -> r02, r04, r07; leave without transaction -> r03; report from live salary -> r05; overlap including cancelled -> r06; payroll counting cancelled leave -> r06, r08; 2x cutoff by check-out time -> r07; 2x for everything -> r04, r05, r07; full (non-partial) unique month index -> r08 0/3; report picking any run -> r08.

## Alt design

- fixed: separate `Employees` table (backfilled for existing users in the migration, upserted by PUT, LEFT JOIN with defaults for users that have no row), `AttendanceDays` storing the shift instants and rounded minutes at check-in/check-out, with unique `(UserId, Date)` and a partial unique "one open record" index (`INSERT ... ON CONFLICT DO NOTHING`), Cairo time via `Intl.DateTimeFormat` in `Src/Lib/Cairo.ts`, `Leaves` with a status column and the balance computed as `21 - SUM(active annual days)` inside a transaction, `PayrollRuns` with a partial unique index on live `(CompanyId, Month)` + `Payslips` rows, report as count/sum + page queries; creates answer 201, `GET /Employees` returns an array.
- alt: no new employee table: salary, shift and a stored `AnnualLeaveLeft` balance are columns added to `Users` with defaults (legacy rows covered by the column defaults), raw SQL through `Db.execute`, `Punches` holding raw times + shift snapshot and a SQL view `PunchMinutes` computing late/overtime with `AT TIME ZONE 'Africa/Cairo'`, concurrency by `SELECT ... FOR UPDATE` on the user row then check-and-insert, balance changed by a guarded `UPDATE ... WHERE AnnualLeaveLeft >= n`, leave days by `generate_series`, payslips stored as a `jsonb` array on the run, live month claimed through a `PayrollMonths (CompanyId, Month) -> LiveRunId` upsert `ON CONFLICT DO UPDATE ... WHERE LiveRunId IS NULL`, report sorted and paged in TypeScript, bad ids -> 400 (own int32 zod check), creates answer 200, `GET /Employees` returns `{ Items }` ordered by name.
