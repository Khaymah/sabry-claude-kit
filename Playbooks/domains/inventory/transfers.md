# Branch Transfers

- **Situation:** moving stock from one branch or warehouse to another, goods in transit, "تحويل بضاعة بين الفروع", receiving a shipment short, cancelling a transfer already on the road.
- **Skip when:** there is a single location, or the other branch is a separate tenant (that is a sale, not a transfer).
- **Decision:** a transfer is a document with lines and a status. Sending removes stock from the source and puts it in transit; receiving adds what arrived to the destination. Every step is its own atomic transaction built on `stock-ledger.md`.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Two or three branches, one step: send and receive happen together |
| Standard | Real goods on the road: send, receive (full or partial), cancel, in-transit quantity |
| Advanced | Many branches, carriers, discrepancies and claims, approvals per branch |

## Rules

### Minimum — always, never cut

- Both stock changes of a step commit in one transaction or neither does: source decrement and destination increment (or in-transit increment) together.
- The source decrement is the guarded update from `stock-ledger.md`; a transfer cannot send more than the source holds.
- A transfer between a branch and itself is 400.
- Source and destination must belong to the caller's tenant; the user acts only on branches in their allowed list.

### Standard — adds

- Statuses: `Draft` → `Sent` → `PartiallyReceived` → `Received`, plus `Cancelled`. The status change is `UPDATE … WHERE "Status" = $expected RETURNING`; no row back is `409 INVALID_STATE`.
- Send writes `TransferOut` movements at the source and raises `StockLevels.InTransit` (or a `TransferLines.SentQuantity`); in-transit is derived from `SentQuantity - ReceivedQuantity - CancelledQuantity` per line, never stored twice.
- Receive takes `ReceivedQuantity` per line, writes `TransferIn` movements at the destination, only by a user allowed at the destination branch. Receiving more than `SentQuantity - ReceivedQuantity` is 409.
- Cancel is allowed from `Draft` and `Sent`; after a partial receive it returns only the remainder `SentQuantity - ReceivedQuantity` to the source with `TransferReturn` movements and marks the lines closed. What was received stays at the destination.
- Each movement references the transfer id as `ReferenceType = "Transfer"`; retried send, receive or cancel inserts once (`backend/reliability/idempotency.md`).
- Reports: "stock by branch" shows `Quantity` plus a separate "in transit" column; "total company stock" adds in-transit. A cancelled transfer must not leave a phantom on either side.
- Lock the two `StockLevels` rows in `(BranchId, ProductId)` order so A→B and B→A at once cannot deadlock.

### Advanced — adds

- Receiving less than sent can close the line with a `Shortage` reason and a claim row instead of waiting forever; the owner's rule decides who bears the loss.
- A transfer value (cost × quantity) is frozen at send, so cost reports do not move when the cost changes.
- Approval step for transfers above a quantity or value threshold (`backend/auth/rbac.md`).

## Edge cases

| Case | Expected behaviour |
|---|---|
| Send 10, receive 6, then cancel | 4 return to the source; destination keeps 6; in-transit is 0; status `Cancelled` with `ReceivedQuantity = 6` kept |
| Receive 12 of 10 sent | 409; nothing written |
| Receive after cancel | 409 `INVALID_STATE` |
| Source runs out between draft and send | Send fails with `OUT_OF_STOCK` for the line; the whole send rolls back |
| Two receivers press receive together | The status guard and the remainder check let one win; the second sees the new remainder |
| Destination branch deactivated mid-transit | Receive still allowed for its manager; new sends to it are blocked |
| User with branch A only sends from B | 404, no leak |
| Same product twice on one transfer | Rejected or merged at the edge; unique `(TransferId, ProductId)` |
| Transfer sent at 23:59 Cairo, received next day | Out movement dated the first day, in movement the second; the gap shows as in-transit in the end-of-day report |
| Data at 100× (200k open transfer lines) | In-transit report uses an index on `(Status, DestinationBranchId)` and aggregates in SQL |
| Twice / parallel: send clicked twice | Status guard lets one through; one set of `TransferOut` movements |
| Product deleted while in transit | Soft-deleted; receive still works |

## Example — Standard, Bun + Hono + Drizzle

```ts
export async function ReceiveTransfer(Db: Db, Ctx: Ctx, TransferId: string, Lines: { ProductId: string; Quantity: number }[]) {
  return Db.transaction(async (Tx) => {
    const [Transfer] = await Tx.select().from(Transfers)
      .where(and(eq(Transfers.TenantId, Ctx.TenantId), eq(Transfers.Id, TransferId), inArray(Transfers.DestinationBranchId, Ctx.BranchIds)))
      .for("update")
    if (!Transfer) throw new AppError("NOT_FOUND", 404)
    if (!["Sent", "PartiallyReceived"].includes(Transfer.Status)) throw new AppError("INVALID_STATE", 409)
    for (const L of [...Lines].sort((A, B) => A.ProductId.localeCompare(B.ProductId))) {
      const Updated = await Tx.execute(sql`
        UPDATE "TransferLines" SET "ReceivedQuantity" = "ReceivedQuantity" + ${L.Quantity}
        WHERE "TransferId" = ${TransferId} AND "ProductId" = ${L.ProductId}
          AND "ReceivedQuantity" + "CancelledQuantity" + ${L.Quantity} <= "SentQuantity"
        RETURNING "Id"`)
      if (Updated.length === 0) throw new AppError("RECEIVE_EXCEEDS_SENT", 409)
      await MoveStock(Tx, { TenantId: Ctx.TenantId, BranchId: Transfer.DestinationBranchId, ProductId: L.ProductId, Delta: L.Quantity, Reason: "TransferIn", ReferenceType: "Transfer", ReferenceId: TransferId, UserId: Ctx.UserId })
    }
    await RefreshTransferStatus(Tx, TransferId)
  })
}
```

`RefreshTransferStatus` sets `Received` when every line has `Received + Cancelled = Sent`, else `PartiallyReceived`. Retries of the same receive need a request key, since receiving 3 twice is legitimate.

Other stacks: the same two guards (status, remainder) work in any SQL; no distributed transaction is needed because both branches share one database.

## Verify

- [ ] `[M]` Killing the process between the two stock changes leaves neither changed.
- [ ] `[S]` Send 10, receive 6, cancel: source +4, destination 6, in-transit 0, total company stock unchanged by the cancel.
- [ ] `[S]` Receiving 12 of 10 is 409; two simultaneous receives of 6 of 10 cannot exceed 10.
- [ ] `[S]` A user of branch A cannot read or receive a transfer into branch B.
- [ ] `[A]` Shortage claim closes the line and the report shows the loss once.

## Pitfalls

- **Cancel returns the full sent quantity after a partial receive** → stock created from nothing → return only the remainder.
- **In-transit stored as its own counter** → drifts from the lines → derive it.
- **Two-step in separate transactions without a status guard** → a crash leaves stock vanished → one transaction per step, guarded.
- **Total stock report ignoring in-transit** → company stock looks lower during shipping → add the column.

## Related

`domains/inventory/stock-ledger.md` · `backend/data/concurrency.md` · `backend/data/multi-tenancy.md` · `backend/reliability/idempotency.md` · `backend/auth/rbac.md`
