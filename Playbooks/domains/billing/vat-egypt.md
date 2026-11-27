# VAT and e-invoices (Egypt)

- **Situation:** adding 14% VAT to prices, tax-inclusive prices, tax invoices, "ضريبة القيمة المضافة", "فاتورة إلكترونية", ETA submission, correcting an issued invoice.
- **Skip when:** the business is not VAT-registered and issues no tax invoices; store zero tax and a flag. Check with the owner's accountant before assuming.
- **Decision:** tax is computed per line in integer piasters with one stated rounding rule, stored on the invoice, and never recomputed later. An issued tax invoice is never edited: corrections are credit notes. The rate, rounding rule and prices-include-VAT setting the owner stated win over the defaults. This is engineering guidance, not tax advice.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Flat 14% on all lines, internal invoices, no government submission |
| Standard | Real tax invoices, exclusive or inclusive prices, credit notes |
| Advanced | Mandatory e-invoice submission to the Egyptian Tax Authority, mixed rates and exemptions |

## Rules

### Minimum — always, never cut

- Amounts are integer piasters (`backend/data/money.md`); rate stored as basis points (`1400`) per line, not a global constant buried in code.
- Each invoice line stores `NetMinor`, `VatRateBps`, `VatMinor`, `GrossMinor`; the invoice stores the sums, with a `CHECK` that they add up.
- Past invoices are never recomputed from today's rate; a rate change applies only to invoices issued after its effective date.

### Standard — adds

- Exclusive: `Vat = round(Net * Rate / 10000)`, `Gross = Net + Vat`. Inclusive: `Vat = round(Gross * Rate / (10000 + Rate))`, `Net = Gross − Vat`. Rounding once per line (default half-up; the owner's rule wins), then sum the lines. Never round the invoice total again.
- The invoice records `PricesIncludeVat boolean` so later reads know which formula produced it.
- Discounts reduce `Net` before VAT is computed; the coupon is allocated across lines first (`domains/billing/coupons.md`).
- Issued invoices are immutable: a database trigger or status check blocks updates to amounts after `issued`. Corrections are a credit note (negative or linked `CreditNotes` row referencing the original invoice and reason), then a new invoice if needed.
- Refunds and splits of issued invoices go through credit notes (`domains/billing/refunds.md`, `domains/billing/invoice-splits.md`).
- Invoice numbers are gapless per tenant and year, assigned at issue time from a counter row updated in the same transaction; a failed issue never leaves a gap.
- Issue time uses `Africa/Cairo` for the tax date.

### Advanced — adds

- ETA e-invoice (note, verify against the current ETA documentation before building): the invoice is submitted as signed JSON; common fields are issuer and receiver tax registration numbers, document type (invoice, credit note, debit note), internal id, date and time of issue, per-line item code, unit, quantity, unit value, tax type and sub-type (T1 for VAT), and totals. The authority returns a UUID and a long id; store both with the submission status and the raw response.
- Submission is an idempotent background job keyed by invoice id; a rejected document is fixed and resubmitted or cancelled within the allowed window, never silently dropped (`backend/reliability/background-jobs.md`).
- Store the QR/validation link returned by the authority on the invoice.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Three lines of 10.00 EGP net, 14% | Each line VAT 1.40; total 4.20, equal to the sum of lines |
| Inclusive price 100.00 | VAT 12.28 (100 × 14 ÷ 114, rounded once), net 87.72 |
| Per-line vs on-total rounding | Per-line is the default; totals may differ by a piastre from a calculator, and that is expected and stored |
| Rate changes on 1 July | Invoices issued before keep the old rate; a late-issued invoice for an earlier period uses the rate in force at its tax date |
| Customer asks to change the name on an issued invoice | Credit note for the whole invoice plus a new one; the old number stays |
| Zero-rated or exempt line | `VatRateBps = 0` with an `ExemptionReason`; not a missing value |
| Old invoices with a single total and no line breakdown | Migrated as one line with the stored tax; never recalculated |
| Data at 100×: monthly run issues 200k invoices | Numbers come from a counter row; use batching with one counter increment per batch, still gapless inside each transaction |
| Twice / parallel: two requests issue the same draft | Conditional `UPDATE … WHERE "Status" = 'draft'` lets one assign the number; the other gets 409 |

## Example — Standard, Bun + Hono + Drizzle

```ts
export const VatExclusive = (NetMinor: bigint, RateBps: bigint) => {
  const VatMinor = (NetMinor * RateBps + 5_000n) / 10_000n
  return { NetMinor, VatMinor, GrossMinor: NetMinor + VatMinor }
}

export const VatInclusive = (GrossMinor: bigint, RateBps: bigint) => {
  const VatMinor = (GrossMinor * RateBps + (10_000n + RateBps) / 2n) / (10_000n + RateBps)
  return { NetMinor: GrossMinor - VatMinor, VatMinor, GrossMinor }
}

export async function IssueInvoice(Tx: TTx, TenantId: string, InvoiceId: string, Year: number) {
  const Counter = await Tx.execute<{ Last: number }>(sql`UPDATE "InvoiceCounters" SET "Last" = "Last" + 1 WHERE "TenantId" = ${TenantId} AND "Year" = ${Year} RETURNING "Last"`)
  const Last = Counter[0]?.Last
  if (Last === undefined) throw new AppError("INVOICE_COUNTER_MISSING", 500)
  const Issued = await Tx.update(Invoices)
    .set({ Status: "issued", Number: Last })
    .where(and(eq(Invoices.Id, InvoiceId), eq(Invoices.TenantId, TenantId), eq(Invoices.Status, "draft")))
    .returning({ Id: Invoices.Id })
  if (Issued.length === 0) throw new AppError("INVOICE_NOT_DRAFT", 409)
}
```

If the update matches no row the transaction throws and the counter increment rolls back, so no gap appears. The counter row must exist (insert on tenant creation); a missing row is a clear `INVOICE_COUNTER_MISSING` error, not a crash on `undefined`.

## Verify

- [ ] `[M]` `VatMinor` per line plus nets equals invoice gross (`CHECK` passes) on 1, 3 and 1,000 lines.
- [ ] `[S]` Inclusive 100.00 gives net 87.72 and VAT 12.28; exclusive 100.00 gives 14.00 and 114.00.
- [ ] `[S]` Editing amounts on an issued invoice is rejected; a credit note works.
- [ ] `[S]` 20 parallel issues give 20 consecutive numbers, no gaps, no duplicates.
- [ ] `[A]` A rejected ETA submission stays visible and retriable; a repeated job does not create a second submission.

## Pitfalls

- **Editing an issued invoice** → books no longer match what the authority holds → credit note and new invoice.
- **`Gross * 0.14`** → floats and wrong base for inclusive prices → basis points and the inclusive formula.
- **Rounding the total again** → lines no longer add up → round per line only.
- **Numbering from `MAX(Number) + 1`** → duplicates under parallel issue → counter row in the transaction.

## Related

`backend/data/money.md` · `backend/data/audit-log.md` · `domains/billing/refunds.md` · `domains/billing/invoice-splits.md` · `backend/reliability/background-jobs.md`
