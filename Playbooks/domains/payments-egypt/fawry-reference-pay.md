# Pay-at-Outlet Reference Codes

- **Situation:** Fawry-style reference numbers paid in cash at an outlet or through a bank/wallet app, "كود فوري", "العميل دفع في الفرع والاوردر لسه معلق", "الكود انتهى".
- **Skip when:** only card checkout (`gateway-checkout.md`). Pay-at-outlet through a hosted gateway's own "cash collection" method follows this file too.
- **Decision:** we create a reference with our amount and an expiry; the order stays pending until a signed notification (or our own status inquiry) says paid. Money arriving after expiry or cancel is a first-class state, not an error. Field names, signature recipe and statuses differ per provider and version: verify against current docs; this file describes the shape. Conventions are defaults when the project has none; the owner's rules and existing code win; the safety invariants stay absolute.

## Levels

| Level | Pick when |
|---|---|
| Minimum | A handful of orders a day, staff can check each by hand |
| Standard | Production volume |
| Advanced | Several providers, daily settlement files |

## Rules

### Minimum — always, never cut

- Create the reference server-side with `Order.TotalMinor`, currency and `MerchantRefNum` (ours, unique per attempt). Store the provider's reference number and `ExpiresAt` in `PaymentReferences`.
- Notification endpoint verifies the provider's signature (concatenated documented fields hashed with the shared secret) with a constant-time compare, before any state change.
- Mark paid only when the notification is a paid status and its amount and currency equal our stored reference amount, and its reference belongs to our row.
- The paid transition is one conditional update on `Status = 'Pending'`; a repeated notification changes nothing.

### Standard — adds

- Expiry is ours as well as the provider's: `ExpiresAt` is stored; the UI shows it in Africa/Cairo (`backend/data/time-zones.md`). Set our expiry shorter than or equal to the provider's, never longer.
- A job moves expired `Pending` references to `Expired` and releases held stock (`domains/inventory/reservations.md`); it first asks the provider for status so a payment in flight is not lost.
- Payment after expiry or after the order was cancelled: store it as `PaidLate`, keep the money visible, alert staff. Staff either reopen the order (if stock allows) or refund (`gateway-refunds-voids.md`). Never auto-ship, never discard.
- Status inquiry by `MerchantRefNum` as fallback: pending references older than 30 minutes are polled with backoff (every 15 min for 2 h, then hourly until expiry), through the shared adapter (`backend/reliability/outbound-calls.md`).
- Record every notification in `ProcessedWebhooks` before processing (`backend/reliability/idempotency.md`); answer `200` fast, process in a job.
- One order, several references allowed (customer asks for a new code): only one reference may be `Paid`; a second paid is `Duplicate` and goes to the refund path.

### Advanced — adds

- Settlement file import matched to references; unmatched lines open a ticket.
- Reference regeneration keeps the old one valid until its own expiry, or cancels it at the provider when the API allows.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Customer pays the next day, reference expired | Notification recorded `PaidLate`; order not shipped automatically; staff decide: reopen or refund |
| Paid at 23:59 outlet time, notification at 00:03 | Expiry is checked by the provider's paid timestamp when present, else by our receipt time; the order is paid if the provider accepted it |
| Notification amount lower than the order (partial) | Reference stays `Pending`, `PartialPaid` flag with the amount; staff handle; order never marked paid |
| Notification amount higher | Not paid automatically; flagged; the excess is refunded or credited by staff |
| Same notification delivered twice, or twice in parallel | `ProcessedWebhooks` unique plus the conditional update: one transition |
| Different notification types for one reference (created, paid, expired, refunded) arriving out of order | State machine allows only forward moves; `Expired` after `Paid` is ignored |
| Order cancelled by the customer while the reference is still live | Reference marked `Cancelled` locally and at the provider if supported; a later payment becomes `PaidLate` |
| Notification for an unknown reference | Stored in `UnmatchedPayments`, alerted, never dropped |
| Provider inquiry says paid, notification never came | Same transition code as the notification, source `Inquiry` |
| Signature valid but status is a new value | Mapped to `Unknown`, stored, alerted; never treated as paid |
| 100×: Thousands of pending references | Poll only references in the next window by index `(Status, NextCheckAt)`; batch of 200 per run |
| Twice / parallel: Customer requests a new code while the old one is being paid | Both stay valid until their own expiry; the first paid wins, the second becomes `Duplicate` |

## Example — Standard, Bun + Hono + Drizzle

```ts
export async function ApplyReferenceNotification(Note: VerifiedReferenceNote) {
  return db.transaction(async (Tx) => {
    const [Ref] = await Tx.select().from(PaymentReferences)
      .where(eq(PaymentReferences.MerchantRefNum, Note.MerchantRefNum))
      .for("update")
    if (!Ref) {
      await Tx.insert(UnmatchedPayments).values({ Provider: "Fawry", Payload: Note.Redacted })
      return "Unmatched"
    }
    if (Ref.Status === "Paid") return "AlreadyPaid"
    if (Note.AmountMinor !== Ref.AmountMinor || Note.Currency !== Ref.Currency) {
      await Tx.update(PaymentReferences).set({ Status: "AmountMismatch", ReceivedMinor: Note.AmountMinor }).where(eq(PaymentReferences.Id, Ref.Id))
      return "Mismatch"
    }
    const Late = Ref.Status === "Expired" || Ref.Status === "Cancelled"
    await Tx.update(PaymentReferences)
      .set({ Status: Late ? "PaidLate" : "Paid", PaidAt: new Date() })
      .where(eq(PaymentReferences.Id, Ref.Id))
    if (!Late) {
      await Tx.update(Orders).set({ Status: "Paid", PaidAt: new Date() })
        .where(and(eq(Orders.Id, Ref.OrderId), eq(Orders.TenantId, Ref.TenantId), eq(Orders.Status, "PendingPayment")))
    }
    return Late ? "PaidLate" : "Paid"
  })
}
```

Fawry-style signatures concatenate listed fields in a documented order plus the merchant secret and hash them; some providers use HMAC instead. Verify the recipe and the status names against current docs.

## Verify

- [ ] `[M]` A notification with a wrong signature changes nothing; with the right one and the stored amount, the order is `Paid` once.
- [ ] `[M]` The same notification three times, and twice in parallel, gives one transition.
- [ ] `[S]` Notification after `Expired` ends `PaidLate`, order unchanged, alert raised.
- [ ] `[S]` Lower or higher amount does not mark the order paid.
- [ ] `[S]` Notification dropped: the polling job resolves the reference through inquiry.
- [ ] `[A]` An unmatched settlement line appears in the report.

## Pitfalls

- **Expiring the reference and forgetting the customer may still pay** → money received, order dead → `PaidLate` state and alert.
- **Our expiry longer than the provider's** → customer told the code works when it does not → ours is never later.
- **Releasing stock before a final inquiry** → paid order with no stock → ask the provider first.
- **Treating an unknown status as paid or failed** → silent wrong state → `Unknown` plus alert.
- **Showing the expiry in UTC** → customer misses the deadline by two or three hours → Africa/Cairo.

## Related

`domains/payments-egypt/gateway-checkout.md` · `domains/payments-egypt/gateway-refunds-voids.md` · `backend/reliability/idempotency.md` · `backend/reliability/outbound-calls.md` · `backend/data/money.md` · `domains/inventory/reservations.md`
