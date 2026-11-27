# Gateway Refunds and Voids

- **Situation:** returning money through the payment provider, "استرداد الفلوس من الجيت واي", "الريفند فشل", "void ولا refund", partial refund, refund callback.
- **Skip when:** refunds are cash or manual transfer outside the gateway, or the provider dashboard is the only place they happen and we never record them. Business rules for what may be refunded live in `domains/billing/refunds.md` and `domains/commerce/returns.md`.
- **Decision:** our `Refunds` row is created, validated against what was paid and committed before the provider is called, with its own idempotency key. The provider call happens after commit; any failure leaves the row in a retryable state, never a lost one. The refund is complete only when the provider confirms, by response or callback. Provider endpoints, field names and void windows vary and change: verify against current docs; this file describes the shape. Conventions are defaults when the project has none; the owner's rules and existing code win; the safety invariants stay absolute.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Full refunds only, one payment per order, a human watches each |
| Standard | Partial refunds, several refunds per payment, production volume |
| Advanced | Several providers, automated refunds (returns, cancellations), settlement matching |

## Rules

### Minimum — always, never cut

- Insert the `Refunds` row (`Status = 'Requested'`, `IdempotencyKey` unique, amount in minor units, `PaymentAttemptId`) in a transaction that first looks up an existing row by `IdempotencyKey` (found → return it, no amount check), and only for a new key checks the refundable amount under lock (`domains/billing/refunds.md`, `backend/data/money.md`). Only then call the provider.
- Never call the provider inside the database transaction; commit, then call, then update the row.
- The provider call carries our refund id as its idempotency key or merchant reference where the provider supports it (`backend/reliability/idempotency.md`). A retry without one is forbidden.
- Void and refund are different calls: void cancels an authorised or same-day captured transaction before settlement; refund returns money after settlement. Choose by the provider's rule and the transaction's state, not by our guess.
- Refund amount and currency come from our rows, never from the request body; the actor needs the refund permission (`backend/auth/rbac.md`).

### Standard — adds

- Refund states: `Requested`, `Submitted`, `Succeeded`, `Failed`, `NeedsReview`. Transitions only forward; `Failed` may return to `Submitted` by a retry.
- Timeout, `5xx` or network error after the call: the outcome is unknown. Set `Submitted`, never `Failed`; an inquiry by our reference decides (`backend/reliability/outbound-calls.md`).
- A job retries `Requested` and `Submitted` rows older than N minutes with backoff, with the same idempotency key; after the retry budget the row goes `NeedsReview` and alerts.
- Refund callbacks are verified (HMAC or the provider's scheme), recorded in `ProcessedWebhooks`, matched to our row by our reference or the provider's refund id, and applied by the same conditional transition (`gateway-checkout.md`).
- A refund callback with no row of ours (dashboard refund) is stored as an `ExternalRefund` and applied to the payment's refunded total so balances stay true.
- Partial refund total across rows never exceeds the paid amount; the limit is checked again by the provider, and its rejection maps to `REFUND_EXCEEDS_PAID` without changing our totals.
- Refunding to the original method only; the provider decides timing (days to weeks for cards). The customer-facing text says "initiated", not "received".
- Order and stock effects (restock, status `Refunded`/`PartiallyRefunded`) apply only on `Succeeded`.

### Advanced — adds

- Auto-refund of duplicate payments and `PaidOnClosedOrder` from `gateway-checkout.md`, behind a configured ceiling; above it, staff approve.
- Settlement report check that every `Succeeded` refund appears.
- Provider-level refund fees recorded as a separate ledger entry, not netted into the refund amount.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Provider times out after accepting the refund | Row `Submitted`; inquiry or callback finds it `Succeeded`; the retry with the same key does not refund twice |
| Provider rejects: transaction not settled / already voided | Switch the method (refund to void or the reverse) only by an explicit rule in the adapter, with a new attempt row noting why |
| Refund of a line bought with an order discount | The refundable amount is the discounted share; the cap is what was paid (`backend/data/money.md`) |
| Two refunds requested at once for the same payment | Row lock on the payment: the second sees the reduced refundable amount and gets `409` if it no longer fits |
| Refund callback arrives before our `Submitted` update commits | The job retries "not found yet" with backoff; the callback is not dropped |
| Callback says failed after we recorded `Succeeded` | Not applied backwards; stored and alerted for review |
| Refund of an installment or BNPL payment | Provider-specific rules and timing; verify in docs; an unsupported case goes to `NeedsReview` |
| Wallet or cash-at-outlet payment | Often not refundable through the gateway; return through a manual bank transfer with audit (`wallets-instapay.md`) |
| Currency or amount precision differs at the provider | The adapter converts; the core still holds integer minor units |
| Customer disputes (chargeback) after we refunded | Dispute and refund both recorded; total returned never exceeds paid; staff resolve |
| 100×: Mass refund after a cancelled event | Queue with bounded concurrency and a provider rate limit; each refund keeps its own row and key |
| Twice / parallel: Staff clicks refund twice | Unique `IdempotencyKey` on the row (derived from payment id plus a per-action token): one row, one provider call |

## Example — Standard, Bun + Hono + Drizzle

```ts
export async function RequestRefund(Staff: AuthUser, PaymentId: string, AmountMinor: bigint, ActionToken: string) {
  const Refund = await db.transaction(async (Tx) => {
    const [Payment] = await Tx.select().from(PaymentAttempts)
      .where(and(eq(PaymentAttempts.Id, PaymentId), eq(PaymentAttempts.TenantId, Staff.TenantId), eq(PaymentAttempts.Status, "Paid")))
      .for("update")
    if (!Payment) throw new AppError("PAYMENT_NOT_FOUND", 404)
    const Key = `${PaymentId}:${ActionToken}`
    const [Existing] = await Tx.select().from(Refunds).where(and(eq(Refunds.TenantId, Staff.TenantId), eq(Refunds.IdempotencyKey, Key)))
    if (Existing) return Existing
    const [Sum] = await Tx.select({ Total: sql<bigint>`COALESCE(SUM(${Refunds.AmountMinor}), 0)` }).from(Refunds)
      .where(and(eq(Refunds.PaymentAttemptId, PaymentId), ne(Refunds.Status, "Failed")))
    if (AmountMinor <= 0n || AmountMinor > Payment.AmountMinor - BigInt(Sum.Total)) throw new AppError("REFUND_EXCEEDS_PAID", 409)
    const [Row] = await Tx.insert(Refunds)
      .values({ TenantId: Staff.TenantId, PaymentAttemptId: PaymentId, AmountMinor, Currency: Payment.Currency, Status: "Requested", IdempotencyKey: Key, RequestedBy: Staff.Id })
      .returning()
    return Row
  })
  await Enqueue("SubmitRefund", { RefundId: Refund.Id })
  return Refund
}
```

`SubmitRefund` loads the row, sets `Submitted`, calls the adapter with `Refund.IdempotencyKey`, and on an unknown outcome leaves `Submitted` for the retry job. The provider's refund path, amount unit (minor or major) and void window must be checked in current docs.

## Verify

- [ ] `[M]` A refund above the refundable amount returns `409` and no provider call happens.
- [ ] `[M]` The row exists with `Requested` before the provider is called; killing the process after commit leaves a row the job picks up.
- [ ] `[S]` A simulated provider timeout leaves `Submitted`; the retry sends the same key; one refund results.
- [ ] `[S]` Two parallel refunds that together exceed the paid amount: one succeeds, one `409`.
- [ ] `[S]` A refund callback applied twice changes the row once; a late `failed` after `Succeeded` is ignored.
- [ ] `[A]` A dashboard refund appears as `ExternalRefund` and reduces the refundable amount.

## Pitfalls

- **Calling the provider inside the transaction** → a held lock and an unknown outcome on rollback → commit first, then call.
- **Marking `Failed` on a timeout** → the retry creates a second refund → `Submitted` and inquire.
- **Generating the key per attempt** → every retry looks new → key tied to the refund row.
- **Updating the order to `Refunded` on request** → customer told it is done, provider rejects → apply on `Succeeded` only.
- **Using void when settlement already happened** → provider rejects, staff confused → pick by the transaction's state.

## Related

`domains/billing/refunds.md` · `domains/commerce/returns.md` · `domains/payments-egypt/gateway-checkout.md` · `backend/data/money.md` · `backend/reliability/idempotency.md` · `backend/reliability/outbound-calls.md` · `backend/data/audit-log.md`
