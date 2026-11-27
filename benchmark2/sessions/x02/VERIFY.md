# x02 verification

Workspaces built with `/home/user/bench2/tools/build_session.sh /home/user/bench2-new/x02 <kind> <dest>`; `bun run typecheck` passes for broken, fixed and alt. Hidden tests run with `session_check.check`.

| Request | Tests | broken | fixed | alt | naive |
|---|---|---|---|---|---|
| r01 customer price lists by date | 3 | 0/3 | 3/3 | 3/3 | 1/3 |
| r02 quotes + half-up rounding rule | 3 | 0/3 | 3/3 | 3/3 | 1/3 |
| r03 versioned revisions | 3 | 0/3 | 3/3 | 3/3 | 2/3 |
| r04 approval by threshold | 3 | 0/3 | 3/3 | 3/3 | 2/3 |
| r05 convert quote to order | 3 | 0/3 | 3/3 | 3/3 | 1/3 |
| r06 quote expiry + validity setting | 3 | 0/3 | 3/3 | 3/3 | 1/3 |
| r07 customer groups (owner correction) | 3 | 0/3 | 3/3 | 3/3 | 1/3 |
| r08 sales by salesperson report | 3 | 0/3 | 3/3 | 3/3 | 1/3 |

`reference/broken` = the base plus `Src/Lib/Validate.ts` whose `ParseId` bounds ids to int32 (copied from h01).

The r06 tests move the clock with `spyOn(Clock, "Now")` (AGENTS.md: business logic reads time from `Now()`); the clock is pinned to 12:00 UTC and expiry checks keep 2+ days of margin, and `ValidUntil` accepts both day+N and day+N-1.

Naive variant (not shipped, a copy of fixed): float rounding in pounds, Price via `z.coerce.number()`, unbounded Quantity, price sheet one query per product, revision read-then-insert outside the transaction, approve status read outside the transaction, convert through `Orders.CreateOrder` (current product prices, status checked outside the transaction), expiry from `CreatedAt` plus the current global validity, no default-group backfill and no lazy default in the group list, group threshold PATCH re-evaluating existing quotes, report from quote status/quote totals one query per salesperson. It fails at least one test in every request.

## Alt design

- fixed: `PriceLists` + `PriceListItems` rows, price sheet as one SQL with a correlated "newest list" subquery; `Quotes` header + `QuoteVersions` + `QuoteLines` per version, money in BigInt piasters with an explicit half-up helper; every state change in a transaction with `SELECT ... FOR UPDATE` then check; stored `ValidUntil` (issue day + N) set on create/revise, `Expired` computed on read; per-company `QuoteSettings` table; `CustomerGroups` with `IsDefault`, migration backfills every company's `عادي` and sets `Customers.GroupId`, default created lazily for later companies; report as one grouped SQL; creates answer 201, lists wrapped in `{ Items }`.
- alt: `CustomerPriceLists` with the prices in a `jsonb` map, merged in TypeScript (2 queries); one `SalesQuotes` row holding the current snapshot (`Lines` jsonb) plus `SalesQuoteRevisions` (PK QuoteId+Revision), rounding done by Postgres `round(numeric, 2)` in one CTE; concurrency through single conditional `UPDATE ... WHERE State = ... RETURNING` statements (no row locks), stock taken with one `UPDATE ... FROM (VALUES ...)` and a row-count check; validity stored as `IssuedOn` + `ValidDays` (last valid day = issue + N - 1); validity in a generic `CompanySettings` key/value table; customers keep `PricingGroupId NULL` meaning the standard group (no backfill of customers, no lazy group creation); report as two queries joined in TypeScript; creates answer 200, `GET /CustomerGroups` and `GET /Quotes/:Id/Versions` return bare arrays, Approve/Convert return small objects instead of the full quote.
