# Coupons and discount codes

- **Situation:** percent or fixed-amount coupons, promo codes, "كود خصم", limited redemptions, one code per customer, discounts on subscriptions or invoices.
- **Skip when:** discounts are manual price edits by staff with no code. Then it is a plain invoice line.
- **Decision:** a redemption is one atomic conditional increment plus a unique row; discounts are integer math in minor units, one coupon per invoice, never applied to a paid invoice. Code uniqueness is per tenant. The owner's stated rule (stacking, rounding) wins over the defaults.

## Levels

| Level | Pick when |
|---|---|
| Minimum | A few static codes, no usage limit |
| Standard | Limited redemptions, expiry, per-customer limit, real payments |
| Advanced | Campaign batches, stacking rules, first-period-only, high-traffic launches |

## Rules

### Minimum — always, never cut

- `Coupons` has `TenantId`, `Code`, `Kind` (`percent` | `fixed`), `Value` (basis points or minor units), `MaxRedemptions` nullable, `RedeemedCount`, `ExpiresAt` nullable. Unique index on `(TenantId, lower("Code"))`; the same code in two tenants is fine.
- The code is looked up through the tenant filter; a code from another tenant is "not found", never "belongs to someone else".
- Discount math is integer: percent = `Amount * Bps / 10000` with the stated rounding; the discount is clamped to the amount (total never below zero).
- Redeeming never reads a count then writes it back.

### Standard — adds

- Redemption: `UPDATE "Coupons" SET "RedeemedCount" = "RedeemedCount" + 1 WHERE "Id" = $1 AND ("MaxRedemptions" IS NULL OR "RedeemedCount" < "MaxRedemptions") AND ("ExpiresAt" IS NULL OR "ExpiresAt" > $Now) RETURNING`. No row back means exhausted or expired.
- Redemption row `CouponRedemptions (CouponId, InvoiceId)` with unique `InvoiceId`: one coupon per invoice. Per-customer limit: unique `(CouponId, CustomerId)`.
- The counter increment and the redemption insert happen in one transaction with the invoice change; if the invoice save fails, the count rolls back.
- Only draft/open invoices accept a coupon. A paid, void or credited invoice returns 409 (project's code for a state conflict).
- Applying a coupon recomputes discount, tax and total together: the discount is allocated across lines (largest remainder), each line's VAT is recomputed on its discounted net (`domains/billing/vat-egypt.md`), and `Total = Subtotal - Discount + Tax` must still hold (the `CHECK` passes).
- The invoice stores `DiscountMinor` and the coupon's kind and value at redemption time; later edits to the coupon never change old invoices.
- Invalid input (unknown code, malformed) is 400/404; exhausted, expired, wrong state is 409 (defaults; keep the project's). Always tell the user which one.

### Advanced — adds

- First-N-periods coupons keep `PeriodsRemaining` on the subscription; each billing run decrements it in the same transaction as the invoice.
- Batch generation inserts codes with `ON CONFLICT DO NOTHING` and retries collisions; codes use an alphabet without `0/O/1/I`.

## Edge cases

| Case | Expected behaviour |
|---|---|
| 100 users redeem the last 1 of a coupon at once | Exactly one conditional update returns a row; 99 get 409 `COUPON_EXHAUSTED` |
| Same user submits twice | Unique `(CouponId, CustomerId)` or invoice key: second call returns the first result, count moves once |
| `"save10"`, `"SAVE10 "`, Arabic keyboard input | Trimmed and case-folded at the edge; compared by the lowercase unique index |
| Fixed coupon 500 EGP on a 300 EGP invoice | Discount clamped to 300; total zero; zero total is marked paid without calling the provider |
| 100% coupon | Same: no provider charge for zero |
| Percent rounding | Half-up per line by default, or the owner's rule; discount on each line summed, so lines add up to the invoice discount |
| Coupon edited after redemption | Old invoices keep their stored discount |
| Invoice paid, user tries to add a coupon | 409; credit notes are the only way to change a paid amount |
| Data at 100×: 5M redemptions | `RedeemedCount` is the hot path; the redemptions table is indexed on `(CouponId, CustomerId)` and `InvoiceId`; no `COUNT(*)` per request |
| Twice / parallel: apply coupon A and coupon B to one invoice at the same time | Unique `InvoiceId` on redemptions lets one win; the other gets 409 and its counter increment rolls back |

## Example — Standard, Bun + Hono + Drizzle

```ts
export function AllocateDiscount(Nets: bigint[], Discount: bigint, Subtotal: bigint) {
  const Shares = Nets.map((N) => (Discount * N) / Subtotal)
  const Remainder = Discount - Shares.reduce((A, B) => A + B, 0n)
  Shares[Shares.length - 1] += Remainder
  return Shares
}

export async function RedeemCoupon(Tx: TTx, TenantId: string, Code: string, InvoiceId: string, CustomerId: string, Now: Date) {
  const Invoice = await LoadOpenInvoice(Tx, TenantId, InvoiceId)
  const Bumped = await Tx.update(Coupons)
    .set({ RedeemedCount: sql`${Coupons.RedeemedCount} + 1` })
    .where(and(
      eq(Coupons.TenantId, TenantId),
      sql`lower(${Coupons.Code}) = lower(${Code.trim()})`,
      or(isNull(Coupons.MaxRedemptions), lt(Coupons.RedeemedCount, Coupons.MaxRedemptions)),
      or(isNull(Coupons.ExpiresAt), gt(Coupons.ExpiresAt, Now)),
    ))
    .returning()
  const Coupon = Bumped[0]
  if (!Coupon) throw new AppError("COUPON_UNAVAILABLE", 409)
  await Tx.insert(CouponRedemptions).values({ CouponId: Coupon.Id, InvoiceId, CustomerId })
  const Raw = Coupon.Kind === "percent" ? ApplyBasisPoints(Invoice.SubtotalMinor, Coupon.Value) : Coupon.Value
  const Discount = Raw > Invoice.SubtotalMinor ? Invoice.SubtotalMinor : Raw
  const Lines = await Tx.select().from(InvoiceLines).where(eq(InvoiceLines.InvoiceId, InvoiceId)).orderBy(InvoiceLines.Id)
  const Shares = AllocateDiscount(Lines.map((L) => L.NetMinor), Discount, Invoice.SubtotalMinor)
  let Tax = 0n
  for (const [I, L] of Lines.entries()) {
    const Net = L.NetMinor - Shares[I]
    const Vat = VatExclusive(Net, L.VatRateBps).VatMinor
    Tax += Vat
    await Tx.update(InvoiceLines).set({ DiscountMinor: Shares[I], VatMinor: Vat, GrossMinor: Net + Vat }).where(eq(InvoiceLines.Id, L.Id))
  }
  await Tx.update(Invoices).set({ DiscountMinor: Discount, TaxMinor: Tax, TotalMinor: Invoice.SubtotalMinor - Discount + Tax }).where(eq(Invoices.Id, InvoiceId))
}
```

Lines here are tax-exclusive; for inclusive prices use `VatInclusive` on the discounted gross. `LoadOpenInvoice` filters by tenant and throws 409 for any status other than draft/open. A unique-violation on `CouponRedemptions` is mapped to 409 by the error handler.

## Verify

- [ ] `[M]` Same code in two tenants coexists; the other tenant's code returns not found.
- [ ] `[S]` 50 parallel redemptions of a coupon with `MaxRedemptions = 10`: exactly 10 succeed and `RedeemedCount = 10`.
- [ ] `[S]` Second coupon on the same invoice gets 409 and the counter is unchanged.
- [ ] `[S]` Coupon on a paid invoice gets 409.
- [ ] `[S]` Fixed coupon larger than the invoice leaves total 0, never negative.

## Pitfalls

- **Count then increment** → over-redemption under load → conditional `UPDATE … RETURNING`.
- **Global unique on `Code`** → tenant A's code blocks tenant B → unique per tenant.
- **Counter bumped outside the invoice transaction** → burned redemptions on failures → one transaction.
- **Float percent** → off-by-a-piastre totals → basis points and integers.

## Related

`backend/data/concurrency.md` · `backend/data/money.md` · `backend/data/multi-tenancy.md` · `domains/billing/refunds.md`
