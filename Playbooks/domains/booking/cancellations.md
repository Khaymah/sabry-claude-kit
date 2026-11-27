# Cancellations, reschedules, no-shows

- **Situation:** customer cancels or moves a booking, "free cancellation until 24 hours before", no-show fees, deposits (عربون), refunds, staff cancels, reminders and notifications.
- **Skip when:** bookings are paid and managed entirely in an external system with its own policy engine.
- **Decision:** the cancellation policy is data per tenant or service (windows and percentages), evaluated at the moment of the request against the injected clock and stored as a snapshot on the booking. Cancelling is one atomic status change that frees the slot; money moves through the refund rules in `backend/data/money.md`. Windows, percentages and statuses the owner stated or the project already uses win over the defaults here.

## Levels

| Level | Pick when |
|---|---|
| Minimum | No money, cancel until a fixed window, slot freed |
| Standard | Deposits or prepayment, reschedule limits, no-show, notifications |
| Advanced | Tiered refunds, staff-initiated cancellations with compensation, provider disputes, many tenants with different policies |

## Rules

### Minimum — always, never cut

- Cancel is `UPDATE "Bookings" SET "Status" = 'Cancelled', "CancelledAt" = $now WHERE "Id" = $1 AND "TenantId" = $2 AND "Status" IN ('Held','Confirmed') RETURNING`. No row back means it was already cancelled, completed or not theirs: answer by state, not 500.
- Only the booking's owner or a role allowed by `backend/auth/rbac.md` may cancel; the owner check is in the `WHERE`, not after the read: `CustomerId = $actor` for customers, no customer condition only when the actor holds the cancel permission.
- The window is computed from `StartsAt` (UTC) and the injected `Now`; never from the browser's clock or from a local date string.
- A booking that already started or is `Completed` / `NoShow` cannot be cancelled by the customer (409 `BOOKING_NOT_CANCELLABLE`, default code).

### Standard — adds

- Policy rows: `FreeUntilHours`, `LateFeePercentBps`, `NoShowFeePercentBps`, `MaxReschedules`. Copy the applicable values into the booking at creation (`PolicySnapshot jsonb`), so a later policy change never rewrites what the customer agreed to.
- Refund amount = deposit or paid amount per the snapshot, computed in integer minor units with basis points and the project's rounding rule; the refund is a row, created in the same transaction as the cancellation through the locked `CreateRefund` of `domains/billing/refunds.md` (keyed by the payment, the booking as `ReferenceType`/`ReferenceId`), and the provider call happens after commit through a job with an idempotency key (`backend/reliability/idempotency.md`, `backend/reliability/background-jobs.md`).
- Reschedule keeps the booking id and re-uses the double-booking write (one `UPDATE` of the range, see `domains/booking/double-booking.md`); it counts against `MaxReschedules` with a conditional increment.
- No-show is set by staff or by a job after `EndsAt + grace` (default 15 min), only from `Confirmed`; it applies the no-show fee from the snapshot, never deletes the booking.
- Notifications (customer, staff) are enqueued in the same transaction as the status change (outbox row), sent after commit; a failed SMS or WhatsApp never rolls back a cancellation.
- Reminders are scheduled jobs keyed by `(BookingId, Kind)`; cancelling or rescheduling cancels or re-keys them.
- Write the change to the audit log with actor, old and new status (`backend/data/audit-log.md`).

### Advanced — adds

- When the business cancels, the customer gets a full refund regardless of the snapshot window, plus any compensation the owner defined, and the slot is offered back to a waiting list in order.
- Chargebacks and provider-side refunds arriving by webhook reconcile against the refund rows; an unmatched one raises an alert, never a silent update.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Cancel exactly at the window boundary (24h00m00s before) | Defined by the comparison in one function: `StartsAt - Now >= FreeUntilHours` is free; a test pins the boundary |
| Booking at 00:30 Cairo, window "until the previous day" | Windows are hours before `StartsAt`, not calendar days, so the local midnight does not matter |
| Policy changed after booking | The snapshot applies; only new bookings use the new policy |
| Old bookings without a snapshot | Fall back to the policy version that was active at `CreatedAt`, or treat as free cancellation, decided with the owner and recorded |
| Cancel after the hold expired | The row is `Expired`; return 409 with the state, no refund logic runs |
| Deposit paid by Fawry that settles two days later | Cancel marks the booking; the refund waits for a `Paid` payment row, then runs once |
| Refund provider call fails | The cancellation stands; the refund row stays `Pending` and the job retries with the same idempotency key |
| Reschedule into a taken slot | 409 `SLOT_TAKEN`; the original booking is untouched |
| Customer cancels and staff marks no-show at the same moment | Both are conditional on the current status; the first wins, the second affects 0 rows and reports the current state |
| Data at 100×: end-of-day no-show job over millions of bookings | One `UPDATE … WHERE "Status" = 'Confirmed' AND "EndsAt" < $cutoff` in batches by id range, index on `("Status", "EndsAt")`; notifications are enqueued per row, not sent in the loop |
| Twice / parallel: cancel pressed twice or the request retried | The conditional update affects one row once; the second returns the same final state (200 with `Cancelled`, or 409; one choice, tested), and exactly one refund row exists thanks to a unique `(PaymentId, ReferenceType, ReferenceId)` |

## Example — Standard, Bun + Hono + Drizzle

```ts
export async function CancelBooking(Input: { TenantId: string; BookingId: string; ActorId: string; IsStaff: boolean }, Clock: TClock) {
  const Now = Clock.Now()
  return db.transaction(async (Tx) => {
    const [Row] = await Tx.update(Bookings)
      .set({ Status: "Cancelled", CancelledAt: Now, CancelledBy: Input.ActorId })
      .where(and(eq(Bookings.TenantId, Input.TenantId), eq(Bookings.Id, Input.BookingId), inArray(Bookings.Status, ["Held", "Confirmed"]), gt(Bookings.StartsAt, Now), Input.IsStaff ? undefined : eq(Bookings.CustomerId, Input.ActorId)))
      .returning()
    if (!Row) throw new AppError("BOOKING_NOT_CANCELLABLE", 409)
    const Hours = (Row.StartsAt.getTime() - Now.getTime()) / 3_600_000
    const Policy = Row.PolicySnapshot
    const FeeBps = Hours >= Policy.FreeUntilHours ? 0n : BigInt(Policy.LateFeePercentBps)
    const PaidMinor = Row.PaidMinor
    const FeeMinor = (PaidMinor * FeeBps + 5_000n) / 10_000n
    const RefundMinor = PaidMinor - FeeMinor
    if (RefundMinor > 0n) {
      await CreateRefund(Tx, Input.TenantId, Row.PaymentId, RefundMinor, { Type: "Booking", Id: Row.Id })
    }
    await Tx.insert(Outbox).values({ TenantId: Input.TenantId, Kind: "BookingCancelled", Payload: { BookingId: Row.Id } })
    await WriteAudit(Tx, { TenantId: Input.TenantId, ActorId: Input.ActorId, Action: "BookingCancelled", EntityId: Row.Id })
    return Row
  })
}
```

`CreateRefund` locks the payment and checks the limit, so a later refund on the same payment is not blocked; the provider call runs from the job that reads `Pending` rows.

Other stacks: the same shape with a single `UPDATE … WHERE` and a transactional outbox works in any framework.

## Verify

- [ ] `[M]` Cancelling a booking of another tenant or another customer changes nothing and returns 404/403 by the project's rule.
- [ ] `[M]` After cancel, the same slot can be booked again immediately.
- [ ] `[S]` Cancel 24h00m00s before is free and 23h59m59s before charges the late fee; the amounts are exact integers.
- [ ] `[S]` Sending the cancel request twice in parallel creates exactly one refund row and one notification.
- [ ] `[S]` Changing the policy does not change an existing booking's fee.
- [ ] `[A]` A business-initiated cancellation refunds in full and notifies the waiting list in order.

## Pitfalls

- **Reading the policy at cancel time** → customer sees one rule at booking and another at cancel → snapshot.
- **Calling the refund provider inside the transaction** → a rollback after money moved → outbox and job.
- **Window in calendar days** → local midnight and DST surprises → hours before `StartsAt`.
- **Deleting a cancelled booking** → no audit or revenue trail → status change only.
- **Sending the notification before commit** → customer told about a cancellation that rolled back → after commit.

## Related

`domains/booking/double-booking.md` · `backend/data/money.md` · `backend/reliability/idempotency.md` · `backend/reliability/background-jobs.md` · `backend/data/audit-log.md` · `backend/auth/rbac.md` · `backend/data/time-zones.md`
