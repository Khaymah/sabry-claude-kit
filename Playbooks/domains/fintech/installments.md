# Consumer installment plans

- **Situation:** buy now pay later, split a purchase over months, monthly dues, late fees, early payoff, partial payment, "قسّط على ٦ شهور", rescheduling a customer's dues. Context only: valU, Sympl and similar products; their exact terms are the owner's.
- **Skip when:** an invoice is merely split into a few pre-agreed payments with no interest or late fee: `domains/billing/invoice-splits.md`.
- **Decision:** a plan is a fixed schedule of `Installments` rows generated once at approval; payments are rows allocated to the oldest due first; nothing is ever recomputed from today's rate. Rate, fee and grace values the owner or contract states win over every default here.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Interest-free split, fixed count, manual collection |
| Standard | Auto-collection, late fees, partial payments, early payoff |
| Advanced | Interest-bearing plans, rescheduling, regulated lending, credit limits |

## Rules

### Minimum — always, never cut

- `Plans (TenantId, PrincipalMinor, Currency, Count, StartDate, Status)` and `Installments (PlanId, Number, DueDate, AmountMinor, PaidMinor, Status)`, unique `(PlanId, Number)`, `CHECK ("PaidMinor" BETWEEN 0 AND "AmountMinor")`.
- Generate the schedule once, in one transaction, with `SUM(AmountMinor) = Total` exactly. The remainder goes on the installment the owner named, else the last (`backend/data/money.md`).
- `DueDate` is a calendar date (`date`), not a timestamp. Month-end rule is stated: a plan starting on the 31st uses the last day of shorter months.
- Never regenerate or edit a schedule in place. A change is a reschedule: the old rows close, new rows are written, both reference each other.
- Collection charges are idempotent per `(InstallmentId, Attempt)` (`backend/reliability/idempotency.md`).

### Standard — adds

- A payment allocates oldest-first across open installments in one transaction, locking the plan's installments `ORDER BY "DueDate", "Number"` `FOR UPDATE`. The allocation is stored as rows `(PaymentId, InstallmentId, AmountMinor)` with unique `(PaymentId, InstallmentId)`, never inferred later; a payment that already has allocation rows is returned as processed, so a replay never applies twice. The plan is loaded with its `TenantId` first.
- Overpayment beyond the plan's remaining total is `409`, or credited to the customer's wallet if the project has one; never silently dropped.
- Late fee: computed by a daily job from the installment's `DueDate`, the owner's grace days and a flat or capped amount; written once per installment per rule as a `Fees` row with a unique key `(InstallmentId, FeeType)`. Fees are paid after the installment they belong to is cleared, unless the owner says otherwise. Total late fees are capped by the owner's limit.
- "Overdue" is `DueDate < today in Africa/Cairo` and `PaidMinor < AmountMinor`; the status is derived or set by the job, never typed by hand.
- Early payoff = sum of unpaid principal, plus fees already incurred, minus the unearned interest only if the contract says so. The quote has an expiry date; the payoff transaction re-checks it.
- Plan status moves `Active → Completed` only when every installment is fully paid, in the transaction of the last payment.

### Advanced — adds

- Interest is integer arithmetic in basis points with the schedule method named (flat or declining balance) in code; the rounding rule is applied per installment and the sum is forced to match.
- Reschedule keeps already-paid installments untouched, regenerates only unpaid principal, and needs a reason and an actor in the audit log (`backend/data/audit-log.md`).
- Credit limit: approving a plan decrements the customer's available limit atomically (`UPDATE … WHERE "Available" >= $1`); completion and payoff restore it by the principal paid.
- Collection retries follow `domains/billing/dunning.md`, but the plan, not the invoice, is the unit.

## Edge cases

| Case | Expected behaviour |
|---|---|
| 1000.00 EGP over 3 | 333.33, 333.33, 333.34 (remainder on the named installment) |
| Plan starts Jan 31, monthly | Feb 28/29, Mar 31, Apr 30: anchored to the start day, not the previous due date |
| Payment smaller than the oldest due | Applies in part; installment stays open with `PaidMinor` set; fee clock keeps running on the unpaid part |
| Payment covers two and a half installments | Two closed, the third partially paid, in one transaction |
| Due date falls on Friday or an official holiday | The owner's rule applies (collect next business day, or not); stated once, not guessed |
| Payoff quote issued, then a payment lands | Payoff re-quoted inside the transaction; stale quote is `409` |
| Fee job runs twice | Unique `(InstallmentId, FeeType)`: one fee |
| Data at 100×: millions of installments | Due-today and overdue scans use a partial index on open installments `(DueDate)`; the job pages by id |
| Twice / parallel: Payment webhook and manual payment for the same installment at once | Both lock the plan's installments in the same order; allocations add up and never exceed `AmountMinor` |
| Old plans created before late fees existed | Not charged retroactively; rule carries an effective date |

## Example — Standard, Bun + Hono + Drizzle

```ts
export function BuildSchedule(Principal: bigint, Count: number, Start: Date): { Number: number; DueDate: Date; AmountMinor: bigint }[] {
  const Base = Principal / BigInt(Count)
  const Remainder = Principal - Base * BigInt(Count)
  return Array.from({ length: Count }, (_, I) => {
    const Due = new Date(Date.UTC(Start.getUTCFullYear(), Start.getUTCMonth() + I + 1, 1))
    const LastDay = new Date(Date.UTC(Due.getUTCFullYear(), Due.getUTCMonth() + 1, 0)).getUTCDate()
    Due.setUTCDate(Math.min(Start.getUTCDate(), LastDay))
    return { Number: I + 1, DueDate: Due, AmountMinor: I === Count - 1 ? Base + Remainder : Base }
  })
}

export async function ApplyPayment(TenantId: string, PlanId: string, PaymentId: string, Amount: bigint) {
  return db.transaction(async (Tx) => {
    const [Plan] = await Tx.select().from(Plans).where(and(eq(Plans.Id, PlanId), eq(Plans.TenantId, TenantId))).for("update")
    if (!Plan) throw new AppError("PLAN_NOT_FOUND", 404)
    const Done = await Tx.select().from(PaymentAllocations).where(eq(PaymentAllocations.PaymentId, PaymentId)).limit(1)
    if (Done.length) return
    const Open = await Tx.select().from(Installments)
      .where(and(eq(Installments.PlanId, PlanId), lt(Installments.PaidMinor, Installments.AmountMinor)))
      .orderBy(Installments.DueDate, Installments.Number).for("update")
    let Left = Amount
    for (const Row of Open) {
      if (Left === 0n) break
      const Take = Row.AmountMinor - Row.PaidMinor < Left ? Row.AmountMinor - Row.PaidMinor : Left
      await Tx.update(Installments).set({ PaidMinor: sql`${Installments.PaidMinor} + ${Take}` }).where(eq(Installments.Id, Row.Id))
      await Tx.insert(PaymentAllocations).values({ PaymentId, InstallmentId: Row.Id, AmountMinor: Take })
      Left -= Take
    }
    if (Left > 0n) throw new AppError("PLAN_OVERPAYMENT", 409, { Excess: Left.toString() })
  })
}
```

Other stacks: the same shape; allocation is a loop under row locks, never a sum computed outside the transaction.

## Verify

- [ ] `[M]` Schedules for 1, 3, 7 and 12 installments of awkward totals always sum exactly to the principal.
- [ ] `[M]` A schedule starting on the 31st has valid dates in every month.
- [ ] `[S]` A payment of 2.5 installments closes two, partly pays the third, and stores three allocation rows.
- [ ] `[S]` The fee job run twice creates one fee per installment.
- [ ] `[A]` Reschedule leaves paid installments and their allocations unchanged; old and new schedules link.

## Pitfalls

- **Dividing with `number` and rounding each part** → total off by a piaster → integer division plus the remainder row.
- **Adding months with `setMonth`** → Jan 31 becomes Mar 3 → clamp to the month's last day.
- **Recomputing amounts from the current rate** → old plans change → store the schedule.
- **Overdue as a stored flag set by hand** → drifts from payments → derive it or let one job own it.
- **Fee as a number added to `AmountMinor`** → payments and fees mix → a separate `Fees` row.

## Related

`backend/data/money.md` · `backend/data/concurrency.md` · `domains/billing/invoice-splits.md` · `domains/billing/dunning.md` · `domains/fintech/wallets.md` · `domains/fintech/reconciliation.md`
