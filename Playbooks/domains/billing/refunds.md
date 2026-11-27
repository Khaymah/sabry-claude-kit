# Refunds

- **Situation:** full or partial refund, several refunds on one payment, "استرداد", "رجّع الفلوس", refund after coupon or split.
- **Skip when:** the provider dashboard is the only place refunds happen and we never record them. Then mirror the provider's refund webhook as received.
- **Decision:** a refund is an append-only row validated against what was actually paid, inside the transaction that writes it, with the payment locked. Sum of refunds never exceeds the amount paid, and the limit is the discounted amount, not the list price. Ledger and allocation rules live in `backend/data/money.md`; this file adds only billing specifics.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Full refunds only, one payment per order |
| Standard | Partial refunds, several payments or invoices, a payment provider |
| Advanced | Marketplace splits, refunds to wallet, chargebacks, automated refund policies |

## Rules

### Minimum — always, never cut

- Refunds are rows (`Refunds`), never a mutated invoice or payment amount. Amounts are integer minor units.
- Check and write in one transaction: lock the payment (`SELECT … FOR UPDATE`), compute `Paid − SUM(earlier non-failed refunds)`, reject if the new amount is higher.
- The tenant filter applies when loading the payment; another tenant's payment is "not found".

### Standard — adds

- The limit is `Paid` (what the customer actually paid after coupons and credits), never the invoice subtotal or the plan price.
- Status codes (defaults; keep the project's): amount not a positive integer, or missing → 400; amount above the remainder, payment not captured, or already fully refunded → 409 `REFUND_EXCEEDS_PAID`.
- A refund row is `pending` before the provider call and `succeeded`/`failed` after; pending ones count against the limit, failed ones do not. The provider call carries an idempotency key = refund id (`backend/reliability/idempotency.md`), and runs outside the lock.
- Refunding an invoice line allocates its share of the discount with the same allocation as the original (`backend/data/money.md`); the VAT share is refunded through a credit note (`domains/billing/vat-egypt.md`).
- Refund of a split invoice goes against the child that was paid; refund of a voided invoice is refused.
- Audit entry: who, amount, reason (`backend/data/audit-log.md`); permission check per `backend/auth/rbac.md`.

### Advanced — adds

- Provider refund webhooks reconcile with our rows by provider id; a refund done in the provider dashboard creates a row marked `external`.
- A chargeback is its own record; refunds on a disputed payment are blocked.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Invoice 1,000 EGP, 20% coupon, paid 800: refund request 900 | 409; the maximum is 800, shown in the error |
| Two refunds of 500 on a 800 payment at the same moment | Lock serialises them: the first passes, the second sees 300 left and gets 409 |
| Refund amount `0`, `-5`, `"10.5"`, `1e3` | 400 at the edge; never coerced |
| Provider call times out | Row stays `pending`, counts against the limit; a job asks the provider by idempotency key and settles it |
| Provider rejects the refund | Row `failed`, limit released, the user sees the reason |
| Refund requested after a credit note already returned the VAT | The limit is computed from refund rows and credit notes together |
| Old payments with no stored paid amount | Backfilled from the provider before they can be refunded; refused until then |
| Data at 100×: a payment with thousands of partial refunds | Lock covers one payment row; sum uses index `(PaymentId, Status)`; or a cached `RefundedMinor` updated in the same transaction |
| Twice / parallel: refund button double-clicked | Same idempotency key returns the first refund; without a key, the lock makes the second 409 once the limit is used |

## Example — Standard, Bun + Hono + Drizzle

```ts
export async function CreateRefund(Db: TDb, TenantId: string, PaymentId: string, AmountMinor: bigint) {
  if (AmountMinor <= 0n) throw new AppError("REFUND_INVALID_AMOUNT", 400)
  const Refund = await Db.transaction(async (Tx) => {
    const Rows = await Tx.select().from(Payments)
      .where(and(eq(Payments.Id, PaymentId), eq(Payments.TenantId, TenantId))).for("update")
    const Payment = Rows[0]
    if (!Payment) throw new AppError("PAYMENT_NOT_FOUND", 404)
    const Used = await Tx.select({ Sum: sql<bigint>`coalesce(sum(${Refunds.AmountMinor}), 0)::bigint` }).from(Refunds)
      .where(and(eq(Refunds.PaymentId, PaymentId), ne(Refunds.Status, "failed")))
    if (AmountMinor > Payment.AmountMinor - Used[0].Sum) throw new AppError("REFUND_EXCEEDS_PAID", 409)
    const Created = await Tx.insert(Refunds).values({ TenantId, PaymentId, AmountMinor, Status: "pending" }).returning()
    return Created[0]
  })
  await SendRefundToProvider(Refund)
  return Refund
}
```

`SendRefundToProvider` runs after commit with the refund id as idempotency key, then sets `succeeded` or `failed`.

## Verify

- [ ] `[M]` Refund above paid is rejected; refund of another tenant's payment is 404.
- [ ] `[S]` 10 parallel refunds of 100 on a payment of 500: exactly 5 succeed.
- [ ] `[S]` With a 20% coupon the maximum equals the amount paid, not the list price.
- [ ] `[S]` `0`, negative and decimal amounts give 400; over-limit gives 409.
- [ ] `[S]` Killing the process after the insert leaves a `pending` row that a job settles.

## Pitfalls

- **Limit read before the lock** → two refunds pass → lock first, then sum, in one transaction.
- **Limit from list price** → refunds more than the customer paid → use the paid amount.
- **Provider call inside the transaction** → long lock held on network time → insert pending, commit, then call.
- **Failed refunds counted as used** → customer can never retry → exclude `failed`.

## Related

`backend/data/money.md` · `backend/data/concurrency.md` · `backend/reliability/idempotency.md` · `domains/billing/vat-egypt.md` · `domains/billing/coupons.md`
