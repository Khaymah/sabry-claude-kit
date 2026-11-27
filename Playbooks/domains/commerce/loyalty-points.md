# Loyalty points

- **Situation:** earn points on purchases, redeem points for discount, points expiry, "points balance went negative", points on refunds and returns, referral or birthday bonuses.
- **Skip when:** a stored-value wallet in real money (that is `backend/data/money.md` Advanced), or a provider such as Smile or Yotpo owns the points.
- **Decision:** points are an append-only ledger of signed integers; the balance is a cached column updated in the same transaction by an atomic conditional update; expiry and refund reversals are ledger rows, never edits.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Earn and burn, no expiry |
| Standard | Expiry, refund reversal, redemption at checkout |
| Advanced | Tiers, multipliers, campaigns, liability reporting |

## Rules

### Minimum — always, never cut

- Points are integers (`integer`/`bigint`), never decimals. Earn = `floor(PaidMinor × PointsPerEgp ÷ 100)` computed with integers on the amount paid after discount, on one stated rule.
- `PointsLedger(Id, TenantId, UserId, Delta, Reason, ReferenceType, ReferenceId, CreatedAt)` is append-only. A unique `(TenantId, ReferenceType, ReferenceId, Reason)` makes each award and each reversal happen once.
- `PointsBalances.Balance` with `CHECK (Balance >= 0)`, changed only by `SET Balance = Balance + $d WHERE UserId = $u AND Balance + $d >= 0 RETURNING`, in the same transaction as the ledger row. Never read the balance and write an absolute value.
- Burning needs a stated exchange rate (default 100 points = 1 EGP, stored as data), converted to a discount in minor units at checkout and snapshotted on the order.
- A redemption never exceeds the order total, and never the user's balance.

### Standard — adds

- Earn when the order reaches the state the owner names (default `Delivered`, after the return window if the owner says so), not at placement; a cancelled order earns nothing.
- Expiry: each earn row carries `ExpiresAt`; burning consumes the oldest unexpired first (FIFO) through `PointsLots(RemainingPoints)`. A nightly job writes `Expired` ledger rows for the lots past `ExpiresAt` and deducts the balance atomically.
- Expiry dates and "points expiring in 30 days" are computed in `Africa/Cairo` days.
- Refund or return reverses earned points proportionally to the refunded amount (floor) as a `Reversal` row; redeemed points on that refund go back as a `Restore` row with a new expiry of the owner's choosing.
- If a reversal would make the balance negative (points already spent), the reversal is clamped to the available balance and the shortfall is recorded as `ReversalShortfall` in the row, never a negative balance.
- Redemption is part of checkout's transaction (`domains/commerce/cart-checkout.md`) and idempotent with the order's key.

### Advanced — adds

- Tiers and multipliers are rules as data with effective dates; the ledger row stores which rule produced it.
- Daily reconciliation: `SUM(Delta)` per user equals `Balance`, and `SUM(RemainingPoints)` of lots equals `Balance`; any difference alerts, never auto-fixes.
- Outstanding points liability (points × rate) reported monthly.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Two checkouts at once spending the same 500 points | Atomic conditional update lets one through; the other gets `409 INSUFFICIENT_POINTS` |
| Order paid partly with points, then fully refunded | Cash part refunded in money, points returned as `Restore`, earned points reversed |
| Earned points already burned, then the order is refunded | Reversal clamped to the balance; shortfall recorded; the customer is never negative |
| Same order's "delivered" event arrives twice | Unique key on `(Order, order id, Earn)` makes the second a no-op |
| Redeeming more points than the order total is worth | Capped at the total; leftover points stay |
| Points expire at midnight while a checkout is in flight | The lot is read inside the transaction; expired lots are skipped; the discount is recomputed or `409 PRICE_CHANGED` |
| Rate changed from 100 to 50 points per EGP | Applies to new redemptions; old orders keep their snapshot; ledger rows are untouched |
| Account merged or deleted | Ledger rows move or are anonymised with the user; balance transferred by a pair of rows, never an edit |
| Data at 100×: 200M ledger rows | Balance read from the cached row; ledger indexed `(UserId, CreatedAt)`; expiry job scans only lots with `ExpiresAt <= now()` by index, in batches |
| Twice / parallel: redeem button pressed twice | The order's idempotency key returns the first result; with different keys the balance guard still stops the second |

## Example — Standard, Bun + Hono + Drizzle

```ts
export async function ApplyPoints(Tx: TTx, TenantId: string, UserId: string, Delta: number, Reason: string, ReferenceType: string, ReferenceId: string) {
  const Entry = await Tx.insert(PointsLedger)
    .values({ TenantId, UserId, Delta, Reason, ReferenceType, ReferenceId })
    .onConflictDoNothing()
    .returning({ Id: PointsLedger.Id })
  if (Entry.length === 0) return { Applied: false }
  const Updated = await Tx.update(PointsBalances)
    .set({ Balance: sql`${PointsBalances.Balance} + ${Delta}` })
    .where(and(eq(PointsBalances.TenantId, TenantId), eq(PointsBalances.UserId, UserId), sql`${PointsBalances.Balance} + ${Delta} >= 0`))
    .returning({ Balance: PointsBalances.Balance })
  if (Updated.length === 0) throw new AppError("INSUFFICIENT_POINTS", 409)
  return { Applied: true, Balance: Updated[0].Balance }
}

export const EarnedPoints = (PaidMinor: bigint, PointsPerEgp: bigint) => Number((PaidMinor * PointsPerEgp) / 100n)
```

The balance row is created with the user (or by `INSERT … ON CONFLICT DO NOTHING` before the first earn); the throw rolls back the ledger insert, so a failed burn leaves no row.

Other stacks: any store with unique constraints and conditional updates; an external points provider replaces all of this.

## Verify

- [ ] `[M]` 100 parallel burns of 10 points on a balance of 500: exactly 50 succeed, balance 0, never negative.
- [ ] `[M]` Replaying the same earn event leaves one ledger row and one balance change.
- [ ] `[S]` Refund of a point-paid order restores burned points and reverses earned ones once.
- [ ] `[S]` Expiry job run twice expires each lot once; `SUM(Delta)` still equals `Balance`.
- [ ] `[A]` Reconciliation reports zero differences after a mixed concurrent test.

## Pitfalls

- **`Balance = Balance` computed in JS then written** → lost updates and free points → relative conditional update.
- **Earning at checkout** → points for orders later cancelled → earn on the owner's chosen status.
- **Expiry by deleting ledger rows** → history and balance disagree → `Expired` rows.
- **Fractional points from percentage math** → rounding drift across millions of users → integers and one floor rule.

## Related

`backend/data/money.md` · `backend/data/concurrency.md` · `backend/reliability/idempotency.md` · `backend/reliability/background-jobs.md` · `domains/commerce/returns.md`
