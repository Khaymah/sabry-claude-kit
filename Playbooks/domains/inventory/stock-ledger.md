# Stock Ledger

- **Situation:** on-hand quantity per branch and product, sales that decrement stock, returns, receiving goods, "الكمية في المخزن مش مظبوطة", stock going negative.
- **Skip when:** the product is not tracked (services, digital goods) or an ERP already owns stock and this project only reads it.
- **Decision:** `StockMovements` is the truth, append-only. `StockLevels.Quantity` is a cache changed in the same transaction as its movement by a guarded relative `UPDATE`, never negative.

## Levels

| Level | Pick when |
|---|---|
| Minimum | One branch, a few products, quantity column with a guarded update |
| Standard | Several branches or a real shop: movements table, reason and reference on every change, reconcile job |
| Advanced | High volume or several servers: partitioned movements, per-branch locks on hot rows, snapshot table for fast history |

## Rules

### Minimum — always, never cut

- Decrement with `UPDATE "StockLevels" SET "Quantity" = "Quantity" - $1 WHERE "TenantId" = $t AND "BranchId" = $b AND "ProductId" = $p AND "Quantity" >= $1 RETURNING`. No row back is `409 OUT_OF_STOCK`; never read, check in JS, write (`backend/data/concurrency.md`).
- `CHECK ("Quantity" >= 0)` on the column as the last line of defence.
- Every stock query filters `TenantId` and `BranchId`; the branch comes from the user's allowed branches, not from the request body (`backend/data/multi-tenancy.md`).
- Quantities are integers in the smallest unit sold (pieces, grams). Fractional stock is stored as an integer with a unit factor, never a float.
- Never `UPDATE "Quantity" = <value computed in JS>`. Only relative changes.

### Standard — adds

- Each change inserts a `StockMovements` row in the same transaction: `Delta` (signed), `Reason` (enum: `Sale`, `Return`, `Receive`, `TransferOut`, `TransferIn`, `Adjustment`, `Damage`, `Count`), `ReferenceType`, `ReferenceId`, `CreatedBy`, `CreatedAt`. No movement, no change.
- Unique index on `(ReferenceType, ReferenceId, ProductId, BranchId, Reason)` makes a retried order or webhook insert once (`backend/reliability/idempotency.md`). A duplicate is success, not an error.
- Movements are never updated or deleted. A mistake is a compensating movement with `Reason = Adjustment` and a `ReferenceId` pointing at the wrong one (`backend/data/audit-log.md`).
- Lock rows in `(BranchId, ProductId)` order when one request touches several, so two multi-line orders cannot deadlock.
- A nightly job compares `Quantity` with `SUM("Delta")` per pair and alerts on any difference; it never auto-fixes.
- Allowing negative stock is an owner decision per tenant (selling before receiving). When allowed, drop the `WHERE` guard and the `CHECK` for that tenant only and flag the rows, not the whole rule.

### Advanced — adds

- Partition `StockMovements` by month; `StockLevels` stays small and hot.
- Periodic `StockSnapshots(BranchId, ProductId, AsOf, Quantity)` so "stock on date X" sums only movements after the nearest snapshot.
- Hot products: split into buckets or queue the decrements per product.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Same product on two cart lines | Merged to one total before the guarded update |
| Order line quantity `0`, negative, or `1.5` | 400 at the edge, no movement |
| Return of an item never sold here (other branch) | Allowed only to the branch the owner's rule names; movement references the original order |
| Return after the product was deleted | Products are soft-deleted; the movement keeps the `ProductId` |
| Cached `Quantity` and `SUM(Delta)` disagree | Alert; movements win, a correcting `Adjustment` movement is written by a person, with a reason |
| Row missing for a new (branch, product) pair | Receiving creates it with `INSERT … ON CONFLICT DO UPDATE SET "Quantity" = "StockLevels"."Quantity" + $1`; selling from a missing row is `OUT_OF_STOCK` |
| Sale at 23:59 Cairo, posted at 00:01 | `CreatedAt` is UTC; daily reports bucket by `Africa/Cairo` day of the business event, not insert time |
| Integer overflow on quantity | `integer` caps at 2.1 billion; use `bigint` when units are grams or millilitres |
| Data at 100× (50 million movements) | Reads of "current stock" hit `StockLevels` only; history queries use `(BranchId, ProductId, CreatedAt)` and a date range, never an open scan |
| Twice / parallel: two cashiers sell the last unit | One guarded update matches, the other gets `OUT_OF_STOCK`; one movement exists |
| Same order webhook delivered twice | Unique movement index absorbs it; stock decrements once |
| User of branch A requests branch B's stock by id | 404 (not 403), no leak of existence |

## Example — Standard, Bun + Hono + Drizzle

```ts
export const StockLevels = pgTable("StockLevels", {
  TenantId: uuid("TenantId").notNull(),
  BranchId: uuid("BranchId").notNull(),
  ProductId: uuid("ProductId").notNull(),
  Quantity: bigint("Quantity", { mode: "number" }).notNull().default(0),
}, (T) => [
  primaryKey({ columns: [T.TenantId, T.BranchId, T.ProductId] }),
  check("StockLevelsNonNegative", sql`${T.Quantity} >= 0`),
])

export async function MoveStock(Tx: Tx, M: { TenantId: string; BranchId: string; ProductId: string; Delta: number; Reason: string; ReferenceType: string; ReferenceId: string; UserId: string }) {
  if (!Number.isSafeInteger(M.Delta) || M.Delta === 0) throw new AppError("STOCK_INVALID_DELTA", 400)
  const Inserted = await Tx.insert(StockMovements).values(M).onConflictDoNothing().returning({ Id: StockMovements.Id })
  if (Inserted.length === 0) return
  const Updated = await Tx.execute(sql`
    UPDATE "StockLevels" SET "Quantity" = "Quantity" + ${M.Delta}
    WHERE "TenantId" = ${M.TenantId} AND "BranchId" = ${M.BranchId} AND "ProductId" = ${M.ProductId}
      AND "Quantity" + ${M.Delta} >= 0
    RETURNING "Quantity"`)
  if (Updated.length === 0) throw new AppError("OUT_OF_STOCK", 409)
}
```

The thrown error rolls back the movement insert, so a failed decrement leaves no movement. A positive `Delta` for a missing row needs the upsert from the edge-case table.

Other stacks: any SQL database works the same; without `RETURNING` (MySQL) check the affected-row count.

## Verify

- [ ] `[M]` 20 parallel sales of the last unit: exactly one succeeds, `Quantity` is 0, never negative.
- [ ] `[M]` Querying branch B with a branch A user returns nothing.
- [ ] `[S]` Replaying the same order id adds no second movement and no second decrement.
- [ ] `[S]` `SUM("Delta")` equals `Quantity` for every pair after a mixed concurrent test.
- [ ] `[A]` "Stock on date X" matches the movement sum and runs fast on 50 million rows.

## Pitfalls

- **Decrement without the `WHERE Quantity >= $1`** → oversold stock under load → guard in SQL.
- **Movement insert outside the transaction** → cache and ledger drift → one transaction.
- **Editing or deleting a wrong movement** → history is no longer trustworthy → compensating movement.
- **Branch id taken from the request body** → a cashier moves another branch's stock → derive from the session.

## Related

`backend/data/concurrency.md` · `backend/data/multi-tenancy.md` · `backend/data/audit-log.md` · `backend/reliability/idempotency.md` · `domains/inventory/transfers.md` · `domains/inventory/reservations.md`
