# Batches and Expiry

- **Situation:** lots or batch numbers, expiry dates (food, cosmetics, pharmacy), FEFO, expired goods, recalls, "تاريخ الصلاحية", "اللوت".
- **Skip when:** products have no expiry or traceability need; serial-number tracking per unit is a different feature.
- **Decision:** stock is tracked per `(Branch, Product, Batch)` when the product is batch-tracked. Picking is FEFO (earliest expiry first) inside one guarded transaction; expired and recalled batches are not sellable by a rule in SQL, not in the UI.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Expiry matters, small volume: batches with expiry, FEFO picking, no selling expired |
| Standard | Regulated or food/cosmetics: recall, near-expiry alerts, batch on every movement and receipt |
| Advanced | Pharmacy-grade traceability: forward and backward trace, supplier lot link, quarantine workflow |

## Rules

### Minimum — always, never cut

- Batch-tracked products keep stock in `StockBatches(TenantId, BranchId, ProductId, BatchId, Quantity)` with `CHECK ("Quantity" >= 0)`; `StockLevels.Quantity` is their sum, updated in the same transaction.
- A sale of a batch-tracked product must resolve to specific batches. Selling "from the product" without a batch is not allowed.
- Expired means `ExpiryDate < current date in Africa/Cairo`. Compare dates, not timestamps; the last day of expiry is usable unless the owner says otherwise.
- The sellable predicate lives in the picking query: `ExpiryDate >= $today AND "Status" = 'Active'`. No code path may skip it.
- `ExpiryDate` is a `date` column, required at receiving for tracked products.

### Standard — adds

- FEFO: pick `ORDER BY "ExpiryDate", "ReceivedAt", "BatchId"` with `FOR UPDATE SKIP LOCKED` is wrong for stock correctness (it may skip a needed batch); lock in that order with plain `FOR UPDATE`, consume until the quantity is met, then guarded-decrement each batch. Shortage across all sellable batches is `409 OUT_OF_STOCK`.
- Every movement carries `BatchId`; returns go back to the original batch if still sellable, else to a `Quarantine` status batch row.
- `Batches(Id, ProductId, BatchNumber, ExpiryDate, Status: Active | Recalled | Expired | Quarantine, SupplierLotRef)`, unique on `(TenantId, ProductId, BatchNumber, ExpiryDate)` so the same number with a different expiry is a different batch.
- Recall: one transaction sets `Status = 'Recalled'` for the batch, in every branch; reservations on it are released (`reservations.md`); the response lists branches and quantities on hand and sold (by movement) for the owner to act on.
- A daily job marks past-expiry batches `Expired`; correctness never depends on it because the picking query checks the date.
- Near-expiry alert at the owner's window (default 30 days) by a job, per branch, not per request.
- Writing off expired stock is an `Expiry` movement with a reason, through `stock-ledger.md`; the batch quantity goes to zero, the row stays.

### Advanced — adds

- Trace: from a batch to every order that took it, and from an order to its batches, via movements with `ReferenceId`.
- Quarantine release needs an approver (`backend/auth/rbac.md`) and an audit entry.
- Supplier lot link to supplier and purchase order for claims.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Order of 10 with 4 in batch A (soon) and 8 in B | 4 from A, 6 from B; two movements on one order |
| Expiry date today | Sellable on the last day; not tomorrow |
| Batch expires between cart and payment | Pick runs at order confirmation; if it fails the line is `OUT_OF_STOCK`, reservation not converted |
| Same batch number, different expiry in a delivery | Two batches; never merged |
| Return of an item from a recalled batch | Goes to a recalled/quarantine batch, never back to sellable |
| Recall while orders are in flight | Picking sees `Recalled` in the same transaction; reserved units are released |
| Old rows with no batch or expiry (before this rule) | Migrated to an `Unbatched` batch with `Status = 'Quarantine'` until counted; never silently sellable as unexpired |
| Backdated expiry edit | Only by a user with the right, with an audit entry; it cannot make a sold batch unsold |
| Expiry crossing midnight Cairo | `date` compared with `(now() AT TIME ZONE 'Africa/Cairo')::date` |
| Data at 100× (3 million batch rows) | Picking uses a partial index on `(BranchId, ProductId, ExpiryDate) WHERE "Status" = 'Active' AND "Quantity" > 0` |
| Twice / parallel: two orders pick the same near-expiry batch | Row locks in FEFO order; the second sees the reduced quantity and moves to the next batch |
| Batch number typed with spaces or case differences | Trimmed and upper-cased at the edge before the unique check |

## Example — Standard, Bun + Hono + Drizzle

```ts
export async function PickFefo(Tx: Tx, P: { TenantId: string; BranchId: string; ProductId: string; Quantity: number }) {
  const Rows = await Tx.execute(sql`
    SELECT S."BatchId", S."Quantity" FROM "StockBatches" S
    JOIN "Batches" B ON B."Id" = S."BatchId"
    WHERE S."TenantId" = ${P.TenantId} AND S."BranchId" = ${P.BranchId} AND S."ProductId" = ${P.ProductId}
      AND S."Quantity" > 0 AND B."Status" = 'Active'
      AND B."ExpiryDate" >= (now() AT TIME ZONE 'Africa/Cairo')::date
    ORDER BY B."ExpiryDate", B."ReceivedAt", B."Id"
    FOR UPDATE OF S`)
  const Picks: { BatchId: string; Quantity: number }[] = []
  let Left = P.Quantity
  for (const R of Rows) {
    if (Left === 0) break
    const Take = Math.min(Left, Number(R.Quantity))
    Picks.push({ BatchId: R.BatchId as string, Quantity: Take })
    Left -= Take
  }
  if (Left > 0) throw new AppError("OUT_OF_STOCK", 409)
  return Picks
}
```

The caller applies each pick with the guarded decrement and writes one movement per batch with `BatchId`; the locks held by `FOR UPDATE` make the picks safe until commit.

Other stacks: where expiry is checked by an external system (pharmacy network), cache nothing; ask it inside the same step and fail closed.

## Verify

- [ ] `[M]` An order for an expired batch's stock fails even when the UI is bypassed.
- [ ] `[M]` Expiry on today's date sells; the next day it does not (clock set in `Africa/Cairo`).
- [ ] `[S]` Order spanning two batches writes two movements and picks the earlier expiry first.
- [ ] `[S]` Recall blocks all branches in one transaction and releases the batch's reservations.
- [ ] `[S]` 20 parallel orders over two batches never push a batch below zero.
- [ ] `[A]` Trace from a batch lists every order and customer that received it.

## Pitfalls

- **Expiry check in the UI or in the daily job only** → expired goods sold between runs → check in the picking query.
- **Comparing `timestamptz` to a date** → off by a day at midnight Cairo → use `date` and the Cairo day.
- **Merging batches with the same number** → wrong expiry applied → unique on number plus expiry.
- **Returns restocked to sellable** → recalled goods sold again → quarantine by default.

## Related

`domains/inventory/stock-ledger.md` · `domains/inventory/reservations.md` · `backend/data/concurrency.md` · `backend/data/audit-log.md` · `backend/auth/rbac.md`
