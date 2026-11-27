# Proration on plan change

- **Situation:** upgrade or downgrade in the middle of a billing period, "ترقية الباقة", "غيّر الخطة", seat count changes, credit for unused days.
- **Skip when:** plan changes only take effect at the next period start with no credit or charge. Then it is a plain next-period price change.
- **Decision:** unused time on the old plan becomes a credit and remaining time on the new plan a charge, both computed in integer minor units from whole days. The rounding rule the owner stated wins; default is half-up once per line. The next period bills the full new price.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Change applies at the next period, no mid-period money |
| Standard | Immediate upgrade with a prorated charge; downgrade at period end |
| Advanced | Seat changes, add-ons, immediate downgrade with credit balance, several changes per period |

## Rules

### Minimum — always, never cut

- All amounts are integer minor units (`backend/data/money.md`); never `Price * 0.43`.
- The change is one atomic action: lock the subscription row, verify the period, write the new plan and the proration lines in one transaction.
- Proration lines are invoice lines or ledger entries with a reason, never a silent edit of the current invoice.

### Standard — adds

- Whole days: `TotalDays = days(PeriodStart, PeriodEnd)`, `RemainingDays = days(ChangeDate, PeriodEnd)`, both in `Africa/Cairo` calendar days. Use the project's rounding rule; default `Credit = floor(OldPrice * RemainingDays / TotalDays)` for the credit and `Charge = ceil(NewPrice * RemainingDays / TotalDays)` only if the owner says to favour the business; otherwise half-up for both. Name the rule in one function.
- Net = Charge − Credit. Positive: bill it now (or add to next invoice, owner's choice). Negative: store as credit balance, never as a refund unless asked.
- Upgrade is immediate; downgrade is scheduled for `CurrentPeriodEnd` unless the owner says otherwise (`PendingPlanId`).
- The next period bills the new plan's full price, with no leftover proration carried in the price.
- Change date and amounts are stored on the proration row, so the calculation is reproducible later.

### Advanced — adds

- More than one change per period: each change prorates against the plan active at that moment; the sum of segments per period never exceeds one period's price of the highest plan.
- Seat quantity changes use the same formula with `Quantity` as a factor; the multiplication happens before the division.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Change on the first day of the period | `RemainingDays = TotalDays`: full credit, full new charge |
| Change on the last day | One remaining day, not zero; change on the day after period end is a renewal, not a proration |
| 28-, 30-, 31-day periods | `TotalDays` comes from the actual period, never a fixed 30 |
| Upgrade then immediate downgrade, same day | Net is the difference between the two plans' remaining value; no free toggling because each step is its own line |
| Change while an invoice is unpaid | Refused or applied to the next invoice; never edits the open invoice |
| Old subscription with no stored `PriceMinor` | Backfilled from the plan at its subscribe date before it can be prorated |
| Remainder after rounding is one piastre | Stays on the charge line; credit and charge are rounded separately, not netted first |
| Data at 100×: mass plan migration of 100k subscriptions | Batch job, one transaction per subscription, same formula, idempotent on `(SubscriptionId, ChangeId)` |
| Twice / parallel: user double-clicks "Upgrade" | Row lock plus idempotency key; the second call sees the new plan and returns the first result |

## Example — Standard, Bun + Hono + Drizzle

```ts
const DayMs = 86_400_000n

export function CairoDays(From: Date, To: Date): bigint {
  const Start = Date.parse(From.toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" }))
  const End = Date.parse(To.toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" }))
  return BigInt(End - Start) / DayMs
}

export const ProrateHalfUp = (Price: bigint, Remaining: bigint, Total: bigint) =>
  (Price * Remaining * 2n + Total) / (Total * 2n)

export async function ChangePlan(Tx: TTx, Sub: TSubscription, NewPlan: TPlan, At: Date) {
  const Total = CairoDays(Sub.CurrentPeriodStart, Sub.CurrentPeriodEnd)
  const Remaining = CairoDays(At, Sub.CurrentPeriodEnd)
  const Credit = ProrateHalfUp(Sub.PriceMinor, Remaining, Total)
  const Charge = ProrateHalfUp(NewPlan.PriceMinor, Remaining, Total)
  await Tx.insert(ProrationLines).values({ TenantId: Sub.TenantId, SubscriptionId: Sub.Id, CreditMinor: Credit, ChargeMinor: Charge, AtDate: At })
  await Tx.update(Subscriptions).set({ PlanId: NewPlan.Id, PriceMinor: NewPlan.PriceMinor })
    .where(and(eq(Subscriptions.Id, Sub.Id), eq(Subscriptions.TenantId, Sub.TenantId)))
}
```

The caller locks the subscription with `FOR UPDATE` before calling and rejects a change whose `At` is outside the period.

## Verify

- [ ] `[M]` Mid-period upgrade creates proration lines and leaves the current invoice unchanged.
- [ ] `[S]` 30-day period, change on day 10: `RemainingDays = 20`, credit and charge match the hand calculation; a 28-day period uses 28.
- [ ] `[S]` Two parallel upgrade calls produce one set of proration lines.
- [ ] `[S]` Next period's invoice equals the new plan's full price.
- [ ] `[A]` Three changes in one period never total more than the highest plan's period price.

## Pitfalls

- **Fixed 30-day month** → wrong credit in February → actual period length.
- **Multiplying after dividing** → integer division loses the fraction → multiply first, divide once.
- **Using `now()` in UTC for the day** → change at 01:00 Cairo counts as the previous day → Cairo calendar days.
- **Netting before rounding** → a one-piastre mismatch against the provider → round each line, then net.

## Related

`domains/billing/subscriptions.md` · `domains/billing/refunds.md` · `backend/data/money.md` · `backend/data/concurrency.md`
