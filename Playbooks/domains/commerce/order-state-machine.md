# Order state machine

- **Situation:** order statuses, "cancel an order", "mark as shipped", status changes from admin, courier or payment webhook, "order stuck in a wrong status".
- **Skip when:** the order has two states only (open/closed) and no side effects.
- **Decision:** one table of allowed transitions in code; every change is a guarded `UPDATE … WHERE Status = expected`; an illegal or lost-race transition is `409`; side effects happen in the same transaction or through an outbox row; every change writes a history row.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Few statuses, one actor (admin) |
| Standard | Payments, stock, notifications, couriers or several actors |
| Advanced | Partial fulfilment, split shipments, several warehouses |

## Rules

### Minimum — always, never cut

- Statuses are a closed set (Postgres enum or `CHECK`); the allowed transitions live in one map `Transitions[From] = [To…]`, never scattered `if`s.
- Change status only with `UPDATE "Orders" SET "Status" = $to WHERE "Id" = $id AND "TenantId" = $t AND "Status" = $from RETURNING`. No row back → re-read: order missing → 404; status differs → `409 INVALID_TRANSITION` with the current status (defaults; keep the project's codes).
- Never `SELECT` the status, check in JS, then `UPDATE` (`backend/data/concurrency.md`).
- Terminal statuses (`Cancelled`, `Refunded`) have an empty transition list; `Completed` closes fulfilment but still allows `Returned` or `PartiallyReturned` inside the return window (`domains/commerce/returns.md`); reopening is a new order or an explicit admin action with its own row in the map.
- Who may trigger each transition is checked at the edge (`backend/auth/rbac.md`); a customer can only cancel their own order, only from allowed statuses.

### Standard — adds

- Each transition writes `OrderStatusHistory(OrderId, FromStatus, ToStatus, ActorId, Reason, CreatedAt)` in the same transaction; history is append-only.
- Side effects ride the transition: stock return and payment refund request in the same transaction; email, SMS and courier calls go through an outbox row read by a job (`backend/reliability/background-jobs.md`), never inline.
- The side-effect row carries a unique key `(OrderId, ToStatus, Effect)` so a retried transition never repeats it.
- Webhook-driven transitions (payment, courier) map the event to a target status and go through the same guarded function; an event for an earlier state than current is ignored and logged, not an error.
- Timestamps per milestone (`PaidAt`, `ShippedAt`, `DeliveredAt`) are set by the transition, `COALESCE` so a replay never overwrites.

### Advanced — adds

- Fulfilment state lives per shipment, order status derives from its shipments in one function.
- Transition table is data (`OrderTransitions` table) when owners edit workflows; changes are audited (`backend/data/audit-log.md`).

## Edge cases

| Case | Expected behaviour |
|---|---|
| Cancel a shipped order | `409 INVALID_TRANSITION` (default code); the project's existing code wins; the customer is pointed to returns |
| Admin cancels while the courier webhook says "shipped" at the same instant | One guarded `UPDATE` wins; the loser gets `409` (admin) or is ignored and logged (webhook) |
| Payment webhook arrives after the order was cancelled | Order stays `Cancelled`; a refund request is created for the payment, never silently dropped |
| Webhook "delivered" arrives before "shipped" | Accepted if the map allows `Paid → Delivered`, else parked in a pending-events table and replayed when the earlier state lands |
| Status in old rows not in the new enum | Migration maps each to a valid status first; the `CHECK` is added `NOT VALID`, then validated |
| Email provider down at transition time | Transition commits; the outbox row retries; the order is never rolled back for a notification |
| Cancel after partial refund | Allowed only if the map says so; refund amounts are summed from refund rows, never assumed full |
| Data at 100×: 50M history rows | Indexed `(OrderId, CreatedAt)`; the admin timeline is paginated; old history partitioned by month |
| Twice / parallel: customer double-clicks "Cancel" | First flips status and returns stock; second matches no row, re-read shows `Cancelled`, returned as `409` or as idempotent success when the target equals the current status |
| Bulk status change of 1,000 orders | One guarded `UPDATE … WHERE Id = ANY($ids) AND Status = $from RETURNING Id`; the response lists applied and skipped ids |

## Example — Standard, Bun + Hono + Drizzle

```ts
export const Transitions: Record<TOrderStatus, TOrderStatus[]> = {
  Pending: ["Paid", "Cancelled"],
  Paid: ["Processing", "Cancelled", "Refunded"],
  Processing: ["Shipped", "Cancelled"],
  Shipped: ["Delivered", "Returned"],
  Delivered: ["PartiallyReturned", "Returned", "Completed"],
  Completed: ["PartiallyReturned", "Returned"],
  PartiallyReturned: ["PartiallyReturned", "Returned", "Refunded"],
  Returned: ["Refunded"],
  Cancelled: [],
  Refunded: [],
}

export async function ChangeStatus(Tx: TTx, TenantId: string, OrderId: string, To: TOrderStatus, ActorId: string, Now: Date, Reason?: string) {
  const From = (Object.keys(Transitions) as TOrderStatus[]).filter((S) => Transitions[S].includes(To))
  const Changed = await Tx.execute<{ FromStatus: TOrderStatus }>(sql`
    WITH Old AS (
      SELECT "Id", "Status" FROM "Orders"
      WHERE "Id" = ${OrderId} AND "TenantId" = ${TenantId} AND "Status" = ANY(${From}) FOR UPDATE
    )
    UPDATE "Orders" O SET "Status" = ${To}, "UpdatedAt" = ${Now}
    FROM Old WHERE O."Id" = Old."Id"
    RETURNING Old."Status" AS "FromStatus"`)
  if (Changed.length === 0) {
    const [Current] = await Tx.select({ Status: Orders.Status }).from(Orders).where(and(eq(Orders.Id, OrderId), eq(Orders.TenantId, TenantId)))
    if (!Current) throw new AppError("ORDER_NOT_FOUND", 404)
    throw new AppError("INVALID_TRANSITION", 409, { Current: Current.Status, Requested: To })
  }
  await Tx.insert(OrderStatusHistory).values({ OrderId, FromStatus: Changed[0].FromStatus, ToStatus: To, ActorId, Reason })
  if (To === "Cancelled") await ReturnStock(Tx, OrderId)
  await Tx.insert(Outbox).values({ TenantId, Topic: "order.status", Key: `${OrderId}:${To}`, Payload: { OrderId, To } }).onConflictDoNothing()
}
```

`ChangeStatus` joins the caller's transaction, so a payment, shipment or refund write and its status change commit or roll back together. Other stacks: the same guard works in any ORM as a conditional update; an ORM `save()` after a read is the mistake to avoid.

## Verify

- [ ] `[M]` Every pair outside the map returns 409 (table-driven test over all status pairs).
- [ ] `[M]` Two parallel cancels: one success, status `Cancelled`, stock returned once.
- [ ] `[S]` Each transition adds exactly one history row; a failed transition adds none.
- [ ] `[S]` Replaying the same webhook twice leaves one outbox row and one `ShippedAt`.
- [ ] `[A]` Killing the process between commit and email leaves the outbox row that a job then sends.

## Pitfalls

- **Status updated in a controller with `order.Status = x; save()`** → lost updates and illegal jumps → the guarded function only.
- **Side effect before commit** → email sent, transaction rolled back → outbox.
- **Treating a stale webhook as an error** → provider retries forever → ignore, log, return 200.
- **`updated_at` used as history** → no actor, no reason → history table.

## Related

`backend/data/concurrency.md` · `backend/reliability/idempotency.md` · `backend/reliability/background-jobs.md` · `backend/data/audit-log.md` · `domains/commerce/cart-checkout.md`
