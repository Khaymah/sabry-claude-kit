# Shipping and couriers

- **Situation:** shipping fees by governorate, shipping zones, free-shipping threshold, courier integration (Bosta, Aramex, Mylerz, J&T…), courier status webhooks, COD (cash on delivery) collection and settlement.
- **Skip when:** pickup only, or a courier plugin of the store platform already handles fees, labels and statuses.
- **Decision:** fees come from a zone table keyed by governorate, snapshotted on the order; courier events are stored raw, deduplicated, and applied through the order state machine by rank, never by arrival order; COD cash is reconciled against the courier's settlement report. Money: `backend/data/money.md`.

## Levels

| Level | Pick when |
|---|---|
| Minimum | One flat fee or a handful of zones, manual status updates |
| Standard | One courier with API or webhooks, COD |
| Advanced | Several couriers, weight-based rates, automatic courier choice, daily COD settlement |

## Rules

### Minimum — always, never cut

- Governorate is a lookup table with stable ids (27 governorates), not free text; the order stores the id and an address snapshot. Fee is read server-side from `ShippingZones(GovernorateId, FeeMinor, Currency)`; the client never sends a fee.
- The fee is written on the order as `ShippingMinor` at checkout and never recomputed afterwards.
- A governorate without a zone row is `409 SHIPPING_UNAVAILABLE` (defaults; keep the project's codes), not a zero fee.
- Free-shipping threshold compares the subtotal after discount, in minor units, with `>=`; the rule is stored as data.

### Standard — adds

- Webhook endpoint verifies the courier's signature or secret first, on the raw body, with a constant-time compare (`timingSafeEqual` after checking both buffers have the same byte length), then stores the event in `ShipmentEvents(Provider, ExternalEventId, ShipmentId, RawStatus, OccurredAt, Payload)` with unique `(Provider, ExternalEventId)`; duplicate → 200, no effect.
- Map each courier status to an internal status in one table per provider; an unknown raw status is stored and logged, never an error to the courier.
- Apply events by status rank, not arrival: `Delivered` (rank 5) is never overwritten by a late `OutForDelivery` (rank 4). Application goes through `ChangeStatus` (`domains/commerce/order-state-machine.md`), and the order status is reconciled from the stored shipment status, so a failed `ChangeStatus` is repaired by the job retry.
- Respond 200 within the courier's timeout; heavy work goes to a job (`backend/reliability/background-jobs.md`). Outbound calls to the courier use timeouts and retries (`backend/reliability/outbound-calls.md`).
- Creating a courier shipment is idempotent: store the courier's tracking id in a unique column, and send our `OrderId` as the courier's reference so a retry finds the existing shipment.
- COD: the order stores `CodAmountMinor` (the total to collect, zero when prepaid). A COD order is never marked `Paid` at placement; it becomes paid when the courier reports delivery with collection.

### Advanced — adds

- Daily COD reconciliation: import the courier's settlement file, match on tracking id, flag amount differences, missing deliveries and duplicates; unmatched rows go to a review queue, never auto-adjusted.
- Courier fee and COD commission are stored per shipment as expenses, not netted from the order total.
- Zone fees by weight bracket; volumetric weight computed server-side from stored dimensions.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Address governorate name typed in Arabic variants ("القاهره"/"القاهرة") | Resolved to an id by the picker; free text is never matched on the server |
| Remote governorates (Sinai, New Valley, Red Sea) | Own zone rows with higher fees and, where the courier excludes them, no row → `SHIPPING_UNAVAILABLE` |
| Cart reaches free shipping, then a coupon drops it below the threshold | Fee is recomputed at checkout after the discount; the snapshot shows the final value |
| Webhook "Delivered" then a late "Out for delivery" | Second event stored, ignored for status, order stays `Delivered` |
| Same webhook sent three times | One `ShipmentEvents` row; one transition; 200 each time |
| Courier sends an event for an unknown tracking id | 200 and stored as orphan for review; not a 404 that makes the courier retry for days |
| COD customer refuses delivery | `Delivered` never fires; courier status maps to `ReturnToSender`; stock returns when the parcel is received back |
| Courier collected 500.00, order says 499.50 | Reconciliation flags the difference; neither side is auto-corrected |
| Event timestamps in the courier's local time without zone | Parsed as `Africa/Cairo` explicitly, stored as `timestamptz` |
| Data at 100×: 10M shipment events | Unique and `(ShipmentId, OccurredAt)` indexes; timeline paginated; raw payloads older than 90 days archived |
| Twice / parallel: courier retries a webhook while the first is still processing | The unique insert serialises them; the second gets the conflict and returns 200 |

## Example — Standard, Bun + Hono + Drizzle

```ts
const StatusRank: Record<string, number> = { Created: 1, PickedUp: 2, InTransit: 3, OutForDelivery: 4, Delivered: 5, ReturnToSender: 5 }

export async function HandleCourierWebhook(Provider: string, RawBody: string, Signature: string | undefined) {
  if (!VerifySignature(Provider, RawBody, Signature)) throw new AppError("INVALID_SIGNATURE", 401)
  const Event = ParseProviderEvent(Provider, RawBody)
  const Inserted = await db.insert(ShipmentEvents)
    .values({ Provider, ExternalEventId: Event.Id, TrackingId: Event.TrackingId, RawStatus: Event.Status, OccurredAt: Event.OccurredAt, Payload: JSON.parse(RawBody) })
    .onConflictDoNothing()
    .returning({ Id: ShipmentEvents.Id })
  if (Inserted.length === 0) return
  await Jobs.Enqueue("ApplyShipmentEvent", { EventId: Inserted[0].Id })
}

export async function ApplyShipmentEvent(EventId: string, Now: Date) {
  const [Event] = await db.select().from(ShipmentEvents).where(eq(ShipmentEvents.Id, EventId))
  const Internal = MapStatus(Event.Provider, Event.RawStatus)
  if (!Internal) return
  await db.update(Shipments).set({ Status: Internal, StatusRank: StatusRank[Internal] })
    .where(and(eq(Shipments.TrackingId, Event.TrackingId), lt(Shipments.StatusRank, StatusRank[Internal])))
  const [Shipment] = await db.select().from(Shipments).where(eq(Shipments.TrackingId, Event.TrackingId))
  const Target = ToOrderStatus(Shipment.Status)
  const [Order] = await db.select({ Status: Orders.Status }).from(Orders).where(and(eq(Orders.Id, Shipment.OrderId), eq(Orders.TenantId, Shipment.TenantId)))
  if (Order.Status !== Target) await db.transaction((Tx) => ChangeStatus(Tx, Shipment.TenantId, Shipment.OrderId, Target, "system:courier", Now))
}
```

The tenant comes from the shipment row found by tracking id, never from the webhook body. The job reads the stored shipment state after the update, so a crash between the two writes is repaired on retry. `ReturnToSender` shares rank 5 with `Delivered`: they are mutually exclusive, so the second to arrive must be reviewed by hand.

Other stacks: any queue works; the points that matter are the unique event id and the rank guard.

## Verify

- [ ] `[M]` A governorate with no zone row blocks checkout; a client-sent fee is ignored.
- [ ] `[M]` Changing a zone fee leaves old orders' `ShippingMinor` unchanged.
- [ ] `[S]` Replaying a webhook 3 times gives one event row and one status change; a bad signature gives 401 and no row.
- [ ] `[S]` Delivering events in reverse order ends at `Delivered`.
- [ ] `[A]` A settlement file with one short amount, one missing and one duplicate row yields exactly three review items.

## Pitfalls

- **Applying events in arrival order** → delivered order flips back to "in transit" → rank guard.
- **Returning 4xx/5xx for unknown or duplicate events** → courier retry storms → 200 and store.
- **Marking COD orders paid at checkout** → revenue counted for cash never collected → paid on collection.
- **Shipping fee as a client field** → free shipping by editing the request → server table.

## Related

`domains/commerce/order-state-machine.md` · `backend/data/money.md` · `backend/reliability/idempotency.md` · `backend/reliability/outbound-calls.md` · `backend/reliability/background-jobs.md`
