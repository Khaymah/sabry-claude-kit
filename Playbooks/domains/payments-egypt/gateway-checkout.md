# Card Gateway Checkout

- **Situation:** hosted page or iframe card payment in Egypt (Paymob, Kashier, Geidea, Stripe), "الدفع بالكارت", "الـ callback مجاش", "العميل دفع والاوردر لسه pending".
- **Skip when:** payment is cash on delivery or manual transfer only (`wallets-instapay.md`), or a Stripe Checkout Session is the whole flow and we store only its ids.
- **Decision:** our server creates the payment order with our own total; the browser never sends an amount. Only a verified server-to-server callback (or a status inquiry we make ourselves) marks an order paid, once, after amount, currency and order id match. Provider field names, endpoints and signature recipes below describe a shape; verify every one against the provider's current docs and sandbox before coding. Concrete conventions are defaults when the project has none; the owner's rules and existing code win. The safety invariants stay absolute.

## Levels

| Level | Pick when |
|---|---|
| Minimum | One gateway, low volume, orders can be fixed by hand |
| Standard | Production money, any volume |
| Advanced | Several gateways, installments or BNPL, daily settlement matching |

A project taking real card payments uses Standard.

## Rules

### Minimum — always, never cut

- Total comes from our `Orders` row, loaded through the tenant filter. A request body with an amount is ignored; the gateway order is created with `Order.TotalMinor` and `Order.Currency` (`backend/data/money.md`).
- Gateway call shape: create an intention/order with amount, currency, our `MerchantOrderId`, items and billing data; receive a client secret or payment key; send only that to the browser. The secret key and HMAC secret never leave the server.
- The redirect back to our site is a hint, never proof. The success page shows "processing" and reads our order status.
- Callback endpoint: verify the HMAC over the documented fields (order of fields matters for Paymob; Stripe signs the raw body) with a constant-time compare, before any state change. Mismatch: `401`, log only the provider transaction id.
- Mark paid only when `success` is true, not pending, not voided, not refunded, and provider amount, currency and our order id equal our row. Anything else is stored and flagged, never silently accepted.
- The paid transition is one conditional update (`WHERE Status IN ('PendingPayment') RETURNING`), so a duplicate callback changes nothing (`backend/data/concurrency.md`).

### Standard — adds

- Record every callback in `ProcessedWebhooks(Provider, EventId)` unique, enqueue a job, answer `200` fast (`backend/reliability/idempotency.md`, `backend/reliability/background-jobs.md`). The job does verification-dependent state changes.
- Our own `PaymentAttempts` row per checkout try: `OrderId`, `MerchantOrderId` (unique, ours), `ProviderOrderId`, `ProviderTransactionId`, `Status`, `AmountMinor`, `Currency`. One order may have several attempts; only one may be `Paid`.
- All outbound calls through the shared adapter with timeouts and the provider's idempotency key or our unique `MerchantOrderId` (`backend/reliability/outbound-calls.md`).
- Reconciliation job: attempts `Pending` older than 15 minutes are checked by a server-side status inquiry (by `MerchantOrderId`), and resolved with the same transition code as the callback.
- Order status changes follow the order state machine (`domains/commerce/order-state-machine.md`); late success on a cancelled order goes to the exception path below, not to `Paid`.
- Store provider amounts as received next to ours in `ProviderCalls`, redacted of card data. Never store PAN, CVV or full card tokens beyond what the provider returns for display (last four).

### Advanced — adds

- Daily settlement report matched to `PaymentAttempts`; differences open a ticket.
- Failover or per-method routing through the port; one adapter per provider.
- Callback IP allow-list where the provider publishes ranges, on top of HMAC.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Browser tampers the amount or sends a cheaper cart | Ignored: amount is read from our order at intention time |
| Customer edits the cart after the intention was created | Total changed: create a new attempt; the old one can no longer mark the order paid (amount mismatch) |
| Callback amount differs from order total | Not paid; `PaymentMismatch` flag, alert, manual review |
| Callback currency differs (USD vs EGP) | Same: not paid |
| Redirect says success, callback never arrives | Success page polls; reconciliation job inquires and resolves within minutes |
| Callback arrives before our order row's transaction commits | Job fails "not found yet" and retries with backoff |
| Success callback arrives, then a failure callback for the same attempt | Failure is ignored once `Paid`; a state never moves backwards on a late event |
| Failure callback arrives first, then success (retry on the gateway page) | Success wins if verified; the attempt moves `Failed` to `Paid` through the allowed transitions |
| Success arrives for an order cancelled or expired meanwhile | Order stays cancelled; attempt recorded `PaidOnClosedOrder`; staff refund or reopen, never auto-ship |
| Second successful attempt on the same order (double payment) | Second attempt recorded `Duplicate`; auto-refund through `gateway-refunds-voids.md` or queue for staff |
| 3-D Secure abandoned | Attempt stays `Pending` until it expires (30 min), then `Expired`; the order can start a new attempt |
| Callback signed with a field the provider added later | Verifier follows the documented list; unknown fields do not break it; contract test with a documented sample |
| Test mode callback reaches the live endpoint | Mode flag in payload checked against `SystemSettings`; mismatch rejected |
| 100×: callback bursts after an outage | Handler only records and enqueues; job concurrency bounded; unique indexes on `MerchantOrderId` and `EventId` keep it cheap |
| Twice / parallel: same callback twice at once | `ProcessedWebhooks` unique plus the conditional update: one transition, both get `200` |

## Example — Standard, Bun + Hono + Drizzle

```ts
export async function ApplyPaymentResult(Result: VerifiedPaymentResult) {
  return db.transaction(async (Tx) => {
    const [Attempt] = await Tx.select().from(PaymentAttempts)
      .where(eq(PaymentAttempts.MerchantOrderId, Result.MerchantOrderId))
      .for("update")
    if (!Attempt) throw new RetryableError("ATTEMPT_NOT_FOUND_YET")
    if (Attempt.Status === "Paid") return "AlreadyPaid"
    const [Order] = await Tx.select().from(Orders)
      .where(and(eq(Orders.Id, Attempt.OrderId), eq(Orders.TenantId, Attempt.TenantId)))
      .for("update")
    const Matches = Result.AmountMinor === Order.TotalMinor && Result.Currency === Order.Currency
    if (!Result.Success || !Matches) {
      await Tx.update(PaymentAttempts)
        .set({ Status: Result.Success ? "Mismatch" : "Failed", ProviderTransactionId: Result.TransactionId })
        .where(and(eq(PaymentAttempts.Id, Attempt.Id), ne(PaymentAttempts.Status, "Paid")))
      return Result.Success ? "Mismatch" : "Failed"
    }
    if (Order.Status !== "PendingPayment") {
      await Tx.update(PaymentAttempts).set({ Status: "PaidOnClosedOrder", ProviderTransactionId: Result.TransactionId }).where(eq(PaymentAttempts.Id, Attempt.Id))
      return "ClosedOrder"
    }
    await Tx.update(PaymentAttempts).set({ Status: "Paid", ProviderTransactionId: Result.TransactionId, PaidAt: new Date() }).where(eq(PaymentAttempts.Id, Attempt.Id))
    await Tx.update(Orders).set({ Status: "Paid", PaidAt: new Date() }).where(and(eq(Orders.Id, Order.Id), eq(Orders.Status, "PendingPayment")))
    return "Paid"
  })
}
```

`VerifiedPaymentResult` is built only after the HMAC passes (or after our own status inquiry). Paymob concatenates selected transaction fields in a fixed order and signs with HMAC-SHA512; Stripe signs the raw body with a timestamp; Kashier and Geidea each have their own recipe. Verify against current docs.

## Verify

- [ ] `[M]` A checkout request with a tampered amount creates the gateway order with the stored total.
- [ ] `[M]` A callback with a wrong HMAC returns `401` and changes nothing; the same callback with a correct HMAC but a different amount does not mark the order paid.
- [ ] `[M]` The same success callback sent three times leaves one `Paid` transition.
- [ ] `[S]` Success callback dropped: after 15 minutes the job marks the order paid through the inquiry.
- [ ] `[S]` Failure then success, and success then failure, both end `Paid`.
- [ ] `[S]` Success on a cancelled order ends `PaidOnClosedOrder` and raises an alert, not a shipment.
- [ ] `[A]` Settlement file lines all match an attempt; a missing line is reported.

## Pitfalls

- **Trusting the success redirect or a query string** → free orders → server-verified callback only.
- **Parsing JSON before verifying the HMAC** → re-serialisation changes bytes → verify on the raw body or documented fields.
- **Comparing signatures with `===`** → timing leak → constant-time compare.
- **Marking paid on `success: true` alone** → wrong amount or pending/voided flags pass → full comparison plus flags.
- **One order, one gateway order id reused across carts** → stale attempts pay a changed cart → new attempt per amount.
- **Treating Paymob `merchant_order_id` like a free-form value** → duplicates are rejected or collide → our unique id per attempt.

## Related

`backend/data/money.md` · `backend/reliability/idempotency.md` · `backend/reliability/outbound-calls.md` · `backend/reliability/background-jobs.md` · `backend/data/concurrency.md` · `domains/commerce/order-state-machine.md` · `domains/payments-egypt/gateway-refunds-voids.md`
