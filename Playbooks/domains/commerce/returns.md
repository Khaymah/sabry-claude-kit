# Returns and refunds

- **Situation:** return request, partial return, exchange, restock, damaged goods, refund amount, return window ("14 days"), "customer returned part of the order".
- **Skip when:** no physical goods or the provider's dashboard handles refunds manually and nothing is stored here.
- **Decision:** a return is a request with per-line, per-unit quantities; the refund amount comes from what the customer actually paid for that line (discounted, tax-inclusive share), never the list price; the cap on returnable quantity is enforced by an atomic conditional update. Money: `backend/data/money.md`.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Admin records returns by hand, whole-order refunds |
| Standard | Customer-initiated, partial returns, stock and payment refund |
| Advanced | Exchanges, inspection grades, store credit, courier pickup of returns |

## Rules

### Minimum — always, never cut

- `OrderLines.ReturnedQuantity` with `CHECK (ReturnedQuantity <= Quantity)`. A return request raises it with `UPDATE … SET ReturnedQuantity = ReturnedQuantity + $q WHERE Id = $l AND ReturnedQuantity + $q <= Quantity RETURNING`; no row → `409 RETURN_QUANTITY_EXCEEDED`.
- The order must belong to the caller's tenant and, for customers, to the caller; status must allow returns (`Delivered`, `Completed`) per the state machine. Each item `Quantity` is validated at the edge as an integer from 1 to the line's remaining quantity; zero, negative or fractional values are `400`, and duplicate `OrderLineId` entries are merged first.
- Refund per unit = the line's paid amount ÷ quantity, from the stored line (`UnitPriceMinor`, `DiscountMinor`, `TaxMinor`); never the current catalog price.
- Refund total is capped by what is still refundable on the payment (`backend/data/money.md` refund rules).
- Refunding is idempotent (`backend/reliability/idempotency.md`) and the provider call carries our `ReturnId` as reference.

### Standard — adds

- `Returns(Id, OrderId, Status, Reason, RequestedAt)` and `ReturnLines(ReturnId, OrderLineId, Quantity, Condition)`; statuses `Requested → Approved → Received → Refunded | Rejected | Cancelled` through a guarded update. `Rejected` or `Cancelled` before `Received` gives the units back in the same transaction: `UPDATE … SET ReturnedQuantity = ReturnedQuantity - $q WHERE ReturnedQuantity >= $q`, run only when the guarded status update matched a row, so a replay releases once.
- When a return reaches `Received`, the order moves through `ChangeStatus` to `Returned` if every unit is returned, otherwise `PartiallyReturned` (allowed from `Delivered` and `Completed`); a request alone never moves the order.
- Return window is config per tenant (default 14 days) measured from `DeliveredAt`, not `CreatedAt`, in `Africa/Cairo` calendar days: day N ends at `23:59:59` Cairo time. No `DeliveredAt` (never delivered) → not returnable, it is a cancellation.
- Unit amounts are allocated so the sum of all returned units of a line equals the line total: per-unit share by `Allocate`, remainder on the last unit returned. Returning all units refunds exactly the line paid amount.
- Order-level discount and shipping: shipping is refunded only on a whole-order return or when the owner says so; the discount share stays inside the line allocation.
- On `Received`, each return line has a `Condition`: `Resellable` → stock increases (relative `+`) in the same transaction; `Damaged` → no stock, a `StockAdjustments` row with reason.
- COD orders refund by a payout record (wallet, bank transfer, courier cash back) the admin completes, not by an automatic provider call.
- Refund creation and `Refunded` status in one transaction; the provider call goes through the outbox.

### Advanced — adds

- Exchange = return lines plus a new order linked by `ExchangeOfReturnId`; price difference is a charge or refund row.
- Store credit refunds write a ledger entry (`domains/commerce/loyalty-points.md` pattern) instead of a provider refund.
- Fraud signals: return rate per customer, returns of items never received; flagged returns require manual approval.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Two units bought, customer returns 1 then 1 | Each succeeds; a third request fails with `RETURN_QUANTITY_EXCEEDED`; refunds sum exactly to the line total |
| Coupon of 20% on the order, customer returns one item | Refund is that item's discounted amount, not its list price |
| Item price changed in the catalog since purchase | Refund uses the stored line price |
| Window ends today at midnight Cairo, request at 23:50 | Accepted; at 00:01 next day → `409 RETURN_WINDOW_CLOSED` |
| Return requested on an order partly refunded by support | Refundable = paid − already refunded; read in the same transaction |
| Returned and `Damaged` | No restock; refund still due unless the owner's policy says otherwise (a config flag, not hardcoded) |
| Return approved but the parcel never arrives | Stays `Approved` until a job expires it after N days; no refund before `Received` unless the owner chose refund on approval |
| Old orders without per-line discount columns | Backfill by allocating the order discount proportionally to line totals before enabling returns |
| Data at 100×: 5M order lines | Returns read by `OrderId` index; the quantity update touches one line row; reports aggregate by month |
| Twice / parallel: two tabs submit the same return, or customer and admin refund at once | Conditional `ReturnedQuantity` update lets exactly the allowed units through; the refund total is checked with the payment row locked (`FOR UPDATE`) so both cannot pass |

## Example — Standard, Bun + Hono + Drizzle

```ts
export async function RequestReturn(TenantId: string, UserId: string, OrderId: string, Items: { OrderLineId: string; Quantity: number }[], Reason: string, Now: Date) {
  return db.transaction(async (Tx) => {
    const [Order] = await Tx.select().from(Orders)
      .where(and(eq(Orders.Id, OrderId), eq(Orders.TenantId, TenantId), eq(Orders.UserId, UserId)))
      .for("update")
    if (!Order) throw new AppError("ORDER_NOT_FOUND", 404)
    if (!Order.DeliveredAt || !WithinReturnWindow(Order.DeliveredAt, Now)) throw new AppError("RETURN_WINDOW_CLOSED", 409)
    if (Items.some((I) => !Number.isInteger(I.Quantity) || I.Quantity < 1)) throw new AppError("INVALID_QUANTITY", 400)
    const [Return] = await Tx.insert(Returns).values({ TenantId, OrderId, Status: "Requested", Reason }).returning()
    for (const Item of [...Items].sort((A, B) => A.OrderLineId.localeCompare(B.OrderLineId))) {
      const [Line] = await Tx.update(OrderLines)
        .set({ ReturnedQuantity: sql`${OrderLines.ReturnedQuantity} + ${Item.Quantity}` })
        .where(and(eq(OrderLines.Id, Item.OrderLineId), eq(OrderLines.OrderId, OrderId), sql`${OrderLines.ReturnedQuantity} + ${Item.Quantity} <= ${OrderLines.Quantity}`))
        .returning()
      if (!Line) throw new AppError("RETURN_QUANTITY_EXCEEDED", 409, { OrderLineId: Item.OrderLineId })
      await Tx.insert(ReturnLines).values({ ReturnId: Return.Id, OrderLineId: Line.Id, Quantity: Item.Quantity, RefundMinor: LineRefund(Line, Item.Quantity) })
    }
    return Return
  })
}

export function LineRefund(Line: { Quantity: number; ReturnedQuantity: number; PaidMinor: bigint }, Qty: number): bigint {
  const Before = Line.ReturnedQuantity - Qty
  const Upto = (N: number) => (Line.PaidMinor * BigInt(N)) / BigInt(Line.Quantity)
  return Upto(Before + Qty) - Upto(Before)
}
```

`LineRefund` takes cumulative shares, so partial returns of an indivisible amount sum exactly to `PaidMinor` after the last unit (the remainder lands on the last unit). Rejecting the request rolls back the quantity updates.

Other stacks: any language works; what matters is the conditional increment and the cumulative-share rounding.

## Verify

- [ ] `[M]` Returning more units than bought fails; returning 1+1 of 2 succeeds twice, a third fails.
- [ ] `[M]` Two parallel requests for the last unit: one succeeds, `ReturnedQuantity <= Quantity` holds.
- [ ] `[S]` Line paid 100.00 for 3 units, returned one by one: refunds sum to 10000 piasters exactly.
- [ ] `[S]` Request after the window (Cairo day boundary) is rejected; at 23:59 Cairo accepted.
- [ ] `[S]` `Damaged` leaves stock unchanged; `Resellable` raises it once even if `Received` is replayed.
- [ ] `[A]` Exchange total difference is charged or refunded exactly once.

## Pitfalls

- **Refund from `Products.Price`** → customer refunded more than paid → stored line amounts.
- **Window from `CreatedAt` or UTC midnight** → customers lose or gain a day → `DeliveredAt` in Cairo days.
- **Check remaining quantity in JS** → two parallel returns both pass → conditional `UPDATE`.
- **Restock on approval** → stock appears for goods still in transit → restock on `Received`.

## Related

`backend/data/money.md` · `backend/data/concurrency.md` · `backend/reliability/idempotency.md` · `domains/commerce/order-state-machine.md` · `domains/commerce/loyalty-points.md`
