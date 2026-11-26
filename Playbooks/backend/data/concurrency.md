# Concurrency on shared data

- **Situation:** stock, seats, appointment slots, coupons, balances, counters, "first come first served", two admins editing the same record, anything two requests can change at the same moment.
- **Skip when:** each row is only ever written by its single owner, one request at a time (a user's own preferences).
- **Decision:** the database decides, never application code that reads then writes. Use, in this order of preference: an atomic conditional `UPDATE … WHERE <invariant> RETURNING`, a unique constraint, `SELECT … FOR UPDATE` in a short transaction with rows locked in a fixed order, optimistic locking (`Version`) for human edits.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Any limited quantity or money: atomic updates and constraints |
| Standard | Production: concurrency tests, optimistic locking on edited records, deadlock-safe ordering |
| Advanced | High contention (flash sales, ticketing): reservations with expiry, queues, `SERIALIZABLE` with retries |

## Rules

### Minimum — always, never cut

- Never `SELECT` a value, check it in JS, then `UPDATE` it. Put the check in the `UPDATE`'s `WHERE` and read the result with `RETURNING`; no row back means the check failed.
- Increments and decrements are relative (`SET "Stock" = "Stock" - $1`), never an absolute value computed in JS.
- "Only one" rules (one active subscription, one redemption per user, one booking per slot) are unique or partial unique indexes, not `if` statements.
- Invariants that must never break are also `CHECK` constraints (`"Stock" >= 0`, `"Balance" >= 0`).

### Standard — adds

- Multi-row operations that must see a consistent state use `SELECT … FOR UPDATE` inside one short transaction; rows are locked in a fixed order (by `Id`) to avoid deadlocks; no network call inside.
- Records edited in forms by people carry a `Version` integer: `UPDATE … WHERE "Id" = $1 AND "Version" = $2`, increment on write; no row → `409 EDIT_CONFLICT` with the current data, so the user can merge.
- Every race-prone endpoint has a concurrency test (`quality/testability/concurrency-tests.md`).
- Background jobs that must not run twice at once take a Postgres advisory lock (`pg_try_advisory_xact_lock`).

### Advanced — adds

- Reservations: a `Reservations` row with `ExpiresAt` holds stock during checkout; a job releases expired ones; payment confirmation converts the reservation.
- `SERIALIZABLE` for invariants spanning many rows that no single `UPDATE` can express, with a retry loop on `40001` (max 3, jittered).
- Hot rows (one product in a flash sale) are split (stock buckets) or purchases are queued and processed in order.

## Edge cases

| Case | Expected behaviour |
|---|---|
| The same product twice in one cart | Quantities merged before the update, so the stock check sees the total |
| Quantity 3 requested, 2 left | The conditional update matches no row; `409 OUT_OF_STOCK` with the available quantity |
| Order cancelled after payment | Stock returned with a relative increment in the same transaction as the status change |
| Two admins edit the same product | The second save gets `409 EDIT_CONFLICT` and sees the first one's values |
| Deadlock detected (`40P01`) | Fixed by consistent lock order; if it still happens rarely, retried once by the transaction helper |
| Coupon with a total usage limit and a per-user limit | Total: conditional increment of `UsedCount` with `< "MaxUses"`; per user: unique `(CouponId, UserId)` on redemptions |
| 100×: 1,000 buyers for one product | The atomic update holds; if p95 suffers, Advanced reservations or a queue |
| Twice / parallel: the same user clicks "buy" twice | Idempotency key on the request (`backend/reliability/idempotency.md`) plus the stock rule |

## Example — Standard, Drizzle

```ts
export async function ReserveStock(Tx: TTx, Items: { ProductId: string; Quantity: number }[]) {
  const Wanted = new Map<string, number>()
  for (const I of Items) Wanted.set(I.ProductId, (Wanted.get(I.ProductId) ?? 0) + I.Quantity)
  const Ids = [...Wanted.keys()]
  await Tx.select({ Id: Products.Id }).from(Products).where(inArray(Products.Id, Ids)).orderBy(Products.Id).for("update")
  const Values = sql.join([...Wanted].map(([Id, Qty]) => sql`(${Id}::uuid, ${Qty}::int)`), sql`, `)
  const Updated = await Tx.execute<{ Id: string }>(sql`
    UPDATE "Products" AS P SET "Stock" = P."Stock" - V."Quantity"
    FROM (VALUES ${Values}) AS V("Id", "Quantity")
    WHERE P."Id" = V."Id" AND P."Stock" >= V."Quantity" AND P."IsDeleted" = false
    RETURNING P."Id"`)
  const Done = new Set(Updated.map((R) => R.Id))
  const Missing = Ids.filter((Id) => !Done.has(Id))
  if (Missing.length) throw new AppError("OUT_OF_STOCK", 409, { ProductIds: Missing })
}

export async function UpdateProduct(Id: string, Version: number, Changes: TProductChanges) {
  const [Row] = await db.update(Products)
    .set({ ...Changes, Version: sql`${Products.Version} + 1` })
    .where(and(eq(Products.Id, Id), eq(Products.Version, Version), NotDeleted(Products)))
    .returning()
  if (!Row) throw new AppError("EDIT_CONFLICT", 409, { Current: await GetProduct(Id) })
  return Row
}
```

`ReserveStock` runs inside the order's transaction: two statements for any cart size. The `FOR UPDATE … ORDER BY "Id"` locks rows in a fixed order (no deadlocks between carts), the single `UPDATE … FROM (VALUES …)` applies every decrement with its condition, and a missing item throws, which rolls back the whole order. Duplicate lines for one product are merged first.

Other stacks: Prisma `updateMany` with the condition and check `count`; Laravel `where('stock', '>=', $q)->decrement('stock', $q)` and check the affected rows.

## Verify

- [ ] `[M]` No `SELECT` of a quantity followed by an `UPDATE` with a value computed in JS (`look` at every stock / balance / counter write).
- [ ] `[M]` `CHECK ("Stock" >= 0)` exists; one-per-user rules are unique indexes.
- [ ] `[S]` Concurrency test: 20 buyers, 5 in stock → 5 orders, stock 0, 5 rounds.
- [ ] `[S]` Editing with an old `Version` returns 409.
- [ ] `[A]` Expired reservations are released by the job within a minute.

## Pitfalls

- **Read-check-write in a transaction at `READ COMMITTED`** → still races → conditional update or `FOR UPDATE`.
- **Locking rows in request order** → deadlocks under load → sort by id.
- **Absolute writes (`SET "Stock" = 4`)** → lost updates → relative increments.

## Related

`quality/testability/concurrency-tests.md` · `backend/reliability/idempotency.md` · `backend/data/money.md` · `Stacks/Database.md` §5
