# Invoice splits and installments

- **Situation:** split one invoice into parts, installments ("تقسيط الفاتورة"), part now and rest later, two payers for one invoice.
- **Skip when:** the customer pays the full invoice in several payments without separate due dates. That is partial payments on one invoice, no split.
- **Decision:** a split voids the original and creates N child invoices whose totals sum exactly to the original; the remainder goes on the part the owner named (default: the last). Children keep a link to the voided parent and its period, so the billing run never issues that period again.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Equal parts on one unpaid invoice |
| Standard | Custom amounts or dates per part, subscription invoices, taxes and discounts present |
| Advanced | Split after partial payment, several payers, installments with fees |

## Rules

### Minimum — always, never cut

- Only an unpaid, open invoice can be split; a paid or partly paid one returns 409 (project's code).
- Parts are integers in minor units and `SUM(parts) = original TotalMinor`, checked in the transaction and by test. Allocation: `Total / N` floored for every part, remainder on the named part (default last).
- Split is one transaction: lock the original (`FOR UPDATE`), set it `void` with `WHERE "Status" = 'open'`, insert the children. Any failure leaves the original untouched.
- Children carry `TenantId`, `ParentInvoiceId`, `PartNumber`, `PartCount`, and inherit `Currency`.

### Standard — adds

- Discount and tax are allocated with the same remainder rule per component, so each child's subtotal, discount, tax and total add up, and the sums across children equal the parent's.
- Children do not copy `SubscriptionId` or `PeriodStart` (they would hit the unique `(SubscriptionId, PeriodStart)` guard); the voided parent keeps both and keeps holding that key, so the billing run's insert for the period conflicts and nothing is reissued. Children reach the subscription through `ParentInvoiceId`.
- Void is not delete. Voided invoices stay readable, keep their number, and are excluded from revenue and from refundable amounts.
- Splitting requests are idempotent by a client key (`backend/reliability/idempotency.md`); audit entry records who split what (`backend/data/audit-log.md`).
- VAT invoices: a split of an issued tax invoice is a credit note for the original plus new invoices (`domains/billing/vat-egypt.md`).

### Advanced — adds

- Split after a partial payment: the paid amount is moved to the first child as already settled; the remaining parts divide the unpaid balance only.
- Installment schedule is a plan row with due dates; a job reminds on due dates and hands overdue parts to dunning.

## Edge cases

| Case | Expected behaviour |
|---|---|
| 100.00 EGP into 3 | 33.33, 33.33, 33.34 (remainder on the last, or the named part) |
| Total smaller than the parts (5 piastres into 10) | 400: each part must be at least 1 minor unit |
| Billing run reaches the voided period | Its insert conflicts with the voided parent's `(SubscriptionId, PeriodStart)` and does nothing |
| Customer pays the original at the same moment as the split | Row lock decides: payment wins and the split gets 409, or the split wins and the payment is rejected as void |
| Split twice | The second call finds the original already void: 409, or the first result if the idempotency key matches |
| Child later voided | The parent stays void; the child's period is still covered, nothing is reissued |
| Old invoices with no `PartCount` | Treated as standalone; never selected as children |
| Data at 100×: invoice with 5,000 lines split into 12 | Lines stay on the parent; children get summary lines or an allocation table; no per-line copy in memory |
| Twice / parallel: two admins split the same invoice | `UPDATE … WHERE "Status" = 'open'` lets one through; the other 409s and inserts nothing |

## Example — Standard, Bun + Hono + Drizzle

```ts
export const SplitAmounts = (Total: bigint, Parts: number, RemainderIndex = Parts - 1) => {
  const Base = Total / BigInt(Parts)
  const Rest = Total - Base * BigInt(Parts)
  return Array.from({ length: Parts }, (_, I) => (I === RemainderIndex ? Base + Rest : Base))
}

export async function SplitInvoice(Tx: TTx, TenantId: string, InvoiceId: string, Parts: number) {
  const Voided = await Tx.update(Invoices)
    .set({ Status: "void", VoidReason: "split" })
    .where(and(eq(Invoices.Id, InvoiceId), eq(Invoices.TenantId, TenantId), eq(Invoices.Status, "open")))
    .returning()
  const Original = Voided[0]
  if (!Original) throw new AppError("INVOICE_NOT_SPLITTABLE", 409)
  if (BigInt(Parts) > Original.TotalMinor) throw new AppError("SPLIT_TOO_FINE", 400)
  const Amounts = SplitAmounts(Original.TotalMinor, Parts)
  await Tx.insert(Invoices).values(Amounts.map((TotalMinor, I) => ({
    TenantId, ParentInvoiceId: Original.Id, PartNumber: I + 1, PartCount: Parts,
    Currency: Original.Currency,
    TotalMinor, Status: "open",
  })))
}
```

The voided parent stays in `Invoices` with its `(SubscriptionId, PeriodStart)`, so the billing run's `ON CONFLICT DO NOTHING` insert for that period does nothing. Never delete it or null those columns.

## Verify

- [ ] `[M]` `SUM(children) = parent` for 3, 7 and 1 parts, including a total not divisible by the count.
- [ ] `[M]` Splitting a paid invoice returns 409 and writes nothing.
- [ ] `[S]` Run the billing job after a split: no new invoice for the voided period.
- [ ] `[S]` Two parallel splits: one set of children.
- [ ] `[S]` Per-component sums (discount, tax) across children equal the parent's.

## Pitfalls

- **Rounding each part independently** → parts do not add up → floor all, remainder on one named part.
- **Deleting the original** → billing run sees no invoice and bills the period again → void, keep the row.
- **Split outside a transaction** → void without children, money lost from view → one transaction.
- **Counting voided invoices in revenue or refundable totals** → doubled numbers → filter on status.

## Related

`domains/billing/subscriptions.md` · `domains/billing/vat-egypt.md` · `domains/billing/dunning.md` · `backend/data/money.md` · `backend/data/concurrency.md`
