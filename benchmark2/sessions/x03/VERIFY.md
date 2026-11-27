# x03 verification

Workspaces built with `/home/user/bench2/tools/build_session.sh /home/user/bench2-new/x03 <kind> /home/user/bench2-new/_tmp-x03/<kind>`; `bun run typecheck` passes for broken, fixed and alt. Hidden tests (all 12 requests, against the final workspace) run with `session_check.check`. fixed and alt were each run twice with identical results.

| Request | Tests | broken | fixed | alt |
|---|---|---|---|---|
| r01 organizers, events, sessions, categories, availability | 3 | 0/3 | 3/3 | 3/3 |
| r02 holds with 10-minute expiry | 3 | 0/3 | 3/3 | 3/3 |
| r03 purchase a hold + promo (owner per-ticket floor rule) | 4 | 0/4 | 4/4 | 4/4 |
| r04 direct purchase, last seats in parallel | 4 | 0/4 | 4/4 | 4/4 |
| r05 group bookings, all-or-nothing, group discount | 4 | 0/4 | 4/4 | 4/4 |
| r06 gate check-in | 4 | 0/4 | 4/4 | 4/4 |
| r07 refunds (48 h policy) | 3 | 0/3 | 3/3 | 3/3 |
| r08 organizer payout report (Cairo days) | 4 | 0/4 | 4/4 | 4/4 |
| r09 event cancellation + report | 3 | 0/3 | 3/3 | 3/3 |
| r10 ticket transfer, legacy phone formats | 3 | 0/3 | 3/3 | 3/3 |
| r11 fee correction for new events only | 3 | 0/3 | 3/3 | 3/3 |
| r12 per-organizer staff scoping everywhere | 3 | 0/3 | 3/3 | 3/3 |

`reference/broken` is the base plus `Src/Lib/Validate.ts` with `ParseId` bounded to int4, so huge path ids answer 404 instead of reaching the DB.

## Naive variant (not shipped)
A copy of fixed with the obvious implementations: no capacity/price bounds, hold check-then-insert outside a transaction and expiry ignored, discount on the order total with `Math.round`, direct purchase ignoring holds, group booking one transaction per line and compounded discount, check-in and refund read-then-write without a transaction, 50% with `Math.round`, report days in UTC, cancel refunding only `Valid` tickets and keeping the fee, exact-string phone match, new fee by sale date, scope ignored on ticket/purchase routes. Result: r01 2/3, r02 1/3, r03 1/4, r04 1/4, r05 1/4, r06 3/4, r07 1/3, r08 2/4, r09 1/3, r10 2/3, r11 1/3, r12 2/3 (fails ≥1 in every request).

Single-trap checks: transfer without a lock -> r10 1 fail; phone column without backfill of old rows -> r10 1 fail; scope dropped on refund only -> r12 1 fail; new fee applied to every event -> r08 3 fails, r09 1 fail, r11 2 fails (a later request silently breaking earlier ones).

## Alt design
- fixed: modules `Organizers`, `Events`, `Holds`, `Purchases`, `Tickets`; money as `numeric(12,2)`; availability = capacity - live tickets - unexpired active holds, counted inside a transaction after `SELECT ... FOR UPDATE` on the seat-category rows (sorted to avoid deadlocks); promos in a `Promos` table (duplicate -> 409); refunds in a `Refunds` table (unique per ticket); fee rule stamped on the event (`FeePercent`, `FeeFixed`) at creation from `Now()`; report aggregated in SQL with `(ts AT TIME ZONE 'Africa/Cairo')::date BETWEEN`; phone matched by normalizing the stored phone in SQL at query time (no backfill); staff scope loaded once per request as a list of organizer ids; creates answer 201; lists are arrays; reversed report range -> 400 by schema.
- alt: one `Ticketing` module; money as integer piasters columns; an `Inventory (SessionId, CategoryId, Capacity, Sold)` counter row per session x category, seats taken by a single conditional `UPDATE ... WHERE Capacity - Sold - <live holds> >= q` (no explicit row lock); holds, purchase-from-hold, release, check-in, refund and transfer are state-guarded conditional `UPDATE`s; promos as a `jsonb` map on the event (duplicate -> 400); refund amount and time stored on the ticket row; fee rule not stored, derived from the event's `CreatedAt` in TypeScript; report bounds computed as Cairo-midnight timestamps and fee summed in TypeScript; `Customers.PhoneKey` column with a backfill migration and kept in sync by the Customers service; staff scope as an `EXISTS` subquery on `StaffAssignments`; creates answer 200; `GET /Organizers` returns `{ Items }`; check-in runs without a transaction.
