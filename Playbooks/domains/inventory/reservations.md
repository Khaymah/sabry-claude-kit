# Stock Reservations

- **Situation:** holding stock for a cart, a pending payment, a quote or a click-and-collect order; "المنتج اتباع وانا لسه بدفع", flash sales, the last unit, hold expiring.
- **Skip when:** stock is decremented at order creation and unpaid orders are cancelled by a job (simple, and enough for low contention).
- **Decision:** a `Reservations` row with `ExpiresAt` holds quantity. `StockLevels.Reserved` rises in the same transaction by a guarded update; available = `Quantity - Reserved`. A job releases expired holds; payment converts one into a sale.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Hold at checkout start for a fixed time, released by expiry check on read |
| Standard | Production shop: guarded reserve, release job, convert on payment, cancel on abandonment |
| Advanced | Flash sales or tickets: bucketed hot rows, queue, per-customer limits, waiting list |

## Rules

### Minimum — always, never cut

- Reserve with `UPDATE "StockLevels" SET "Reserved" = "Reserved" + $q WHERE … AND "Quantity" - "Reserved" >= $q RETURNING`; no row back is `409 OUT_OF_STOCK` (`backend/data/concurrency.md`).
- `CHECK ("Reserved" >= 0 AND "Reserved" <= "Quantity")`.
- Never compute available in JS from two reads. Return it from SQL as `Quantity - Reserved`.
- A reservation always has `ExpiresAt`; a hold with no expiry is a leak.

### Standard — adds

- `Reservations(Id, TenantId, BranchId, ProductId, Quantity, Status, ExpiresAt, OwnerType, OwnerId)` with `Status` `Active` → `Converted` | `Released` | `Expired`. Transitions are `UPDATE … WHERE "Status" = 'Active' RETURNING`, so release and convert cannot both win.
- Release job (`backend/reliability/background-jobs.md`) every minute: `UPDATE Reservations SET Status = 'Expired' WHERE Status = 'Active' AND ExpiresAt < now() RETURNING`, then subtract the returned quantities from `Reserved` in the same transaction, in batches of 500, under an advisory lock.
- Every reader treats `ExpiresAt < now()` as not held, even before the job runs; the job only reconciles the counter.
- Convert on payment success: writes the `Sale` movement (`stock-ledger.md`), lowers `Quantity` and `Reserved` together, marks `Converted`. Payment arriving after expiry re-reserves with the same guard; if that fails the order goes to a refund path, never oversold.
- Extending a hold is a conditional update on `Status = 'Active'`, capped by the owner's maximum total hold time.
- A reservation belongs to a cart or order id; one cart holds at most one active reservation per product (unique partial index on `Status = 'Active'`). Adding to the cart again changes the quantity, relative.

### Advanced — adds

- Per-customer and per-product caps so one buyer cannot hold the whole drop.
- Hot products split `Reserved` into N buckets chosen by hash, summed on read.
- Waiting list: a released unit offers itself to the next in line before returning to the pool.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Last unit, two buyers click together | One guarded update matches; the other gets `OUT_OF_STOCK`; `Reserved` is 1 |
| Payment confirmed 1 second after expiry | Re-reserve attempted; success converts, failure refunds and tells the buyer |
| Job down for an hour | Readers still ignore expired holds; the counter catches up on the next run, in batches |
| User closes the browser | Hold lives until `ExpiresAt`, then releases; no explicit call needed |
| Cart item quantity lowered | Relative decrease of the reservation and of `Reserved`, one transaction |
| Stock count lowers `Quantity` below `Reserved` | Count adjustment is blocked or marks the shortfall for manual resolution; the `CHECK` stops silent breakage |
| Order cancelled after convert | Return stock with a `Return` movement; there is no reservation to release |
| Expiry at midnight Cairo | `ExpiresAt` is an absolute `timestamptz`; no day math |
| Data at 100× (5 million active holds) | Job works on an index `(Status, ExpiresAt)` in bounded batches; availability reads `StockLevels` only |
| Twice / parallel: release job and payment convert the same hold | The `Status = 'Active'` guard lets one win; the loser sees no row and takes its fallback path |
| Same checkout request retried | Idempotency key returns the existing reservation (`backend/reliability/idempotency.md`) |

## Example — Standard, Bun + Hono + Drizzle

```ts
export async function Reserve(Tx: Tx, R: { TenantId: string; BranchId: string; ProductId: string; Quantity: number; OwnerId: string; Ttl: number }) {
  if (!Number.isSafeInteger(R.Quantity) || R.Quantity <= 0) throw new AppError("INVALID_QUANTITY", 400)
  const Held = await Tx.execute(sql`
    UPDATE "StockLevels" SET "Reserved" = "Reserved" + ${R.Quantity}
    WHERE "TenantId" = ${R.TenantId} AND "BranchId" = ${R.BranchId} AND "ProductId" = ${R.ProductId}
      AND "Quantity" - "Reserved" >= ${R.Quantity}
    RETURNING "Quantity" - "Reserved" AS "Available"`)
  if (Held.length === 0) throw new AppError("OUT_OF_STOCK", 409)
  const [Row] = await Tx.insert(Reservations).values({
    TenantId: R.TenantId, BranchId: R.BranchId, ProductId: R.ProductId, Quantity: R.Quantity,
    OwnerId: R.OwnerId, Status: "Active", ExpiresAt: new Date(Date.now() + R.Ttl),
  }).returning()
  return Row
}

export async function ExpireHolds(Db: Db) {
  return Db.transaction(async (Tx) => {
    const Rows = await Tx.execute(sql`
      UPDATE "Reservations" SET "Status" = 'Expired'
      WHERE "Id" IN (SELECT "Id" FROM "Reservations" WHERE "Status" = 'Active' AND "ExpiresAt" < now() ORDER BY "ExpiresAt" LIMIT 500 FOR UPDATE SKIP LOCKED)
      RETURNING "TenantId", "BranchId", "ProductId", "Quantity"`)
    for (const R of Rows) {
      await Tx.execute(sql`UPDATE "StockLevels" SET "Reserved" = "Reserved" - ${R.Quantity}
        WHERE "TenantId" = ${R.TenantId} AND "BranchId" = ${R.BranchId} AND "ProductId" = ${R.ProductId}`)
    }
    return Rows.length
  })
}
```

Aggregate the quantities per product before the loop when batches are large. `SKIP LOCKED` lets two job instances run without blocking each other.

Other stacks: Redis TTL keys can mirror holds for speed, but the SQL row stays the truth; a key expiring must still go through the release path.

## Verify

- [ ] `[M]` 50 parallel reserves of 1 on stock 1: one succeeds, `Reserved = 1`.
- [ ] `[S]` After expiry plus a job run, `Reserved` equals the sum of remaining active holds.
- [ ] `[S]` Release and convert fired together on one hold: exactly one happens.
- [ ] `[S]` Payment after expiry either re-reserves or refunds; `Quantity` is never below `Reserved`.
- [ ] `[A]` A drop of 100 units with 10,000 buyers sells 100 and holds none past expiry.

## Pitfalls

- **Release only by job and readers trust `Reserved`** → stock looks held for an hour after a job outage → readers also check `ExpiresAt`.
- **Release job without the `Status` guard** → double subtraction → `Reserved` goes negative.
- **Reserve then check available separately** → both buyers pass → one guarded update.
- **No expiry on a hold** → abandoned carts block sales forever.

## Related

`domains/inventory/stock-ledger.md` · `backend/data/concurrency.md` · `backend/reliability/background-jobs.md` · `backend/reliability/idempotency.md`
