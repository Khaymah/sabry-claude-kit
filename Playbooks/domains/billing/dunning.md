# Dunning and failed renewals

- **Situation:** a renewal payment fails, card declined, "الدفع فشل", retry schedule, grace period, suspend and reactivate an account.
- **Skip when:** the provider runs retries and emails itself and we only mirror its status.
- **Decision:** a failed renewal moves the subscription to `past_due`, retries on a fixed schedule, keeps access through a grace period, then suspends; payment at any point reactivates it. Every step is an idempotent job keyed by invoice and attempt number. Schedule lengths the owner stated win over the defaults.

## Levels

| Level | Pick when |
|---|---|
| Minimum | One retry or manual follow-up, an email on failure |
| Standard | Retry schedule, grace period, suspension, reactivation, real recurring payments |
| Advanced | Smart retry by decline code, several payment methods, SLA customers |

## Rules

### Minimum — always, never cut

- A failed payment never deletes data or cancels silently; it changes status through the one transition function (`domains/billing/subscriptions.md`).
- Each retry is idempotent: key `invoiceId:attemptNumber`; a rerun of the job cannot charge twice (`backend/reliability/idempotency.md`).
- All queries are tenant-scoped (`backend/data/multi-tenancy.md`).

### Standard — adds

- Defaults: attempts at +1, +3, +7 days after the first failure (Cairo local date plus N days, never `+ N * 86_400_000` ms); grace period of 7 days from the first failure; suspension after the last failed attempt or the grace end, whichever is later.
- `DunningAttempts (InvoiceId, AttemptNumber, ScheduledAt, Status, DeclineCode)` with unique `(InvoiceId, AttemptNumber)`. The retry job lists due ids, then claims each attempt inside its own transaction with `FOR UPDATE SKIP LOCKED` and re-checks the status there (a lock taken outside a transaction is released at once) (`backend/reliability/background-jobs.md`).
- Hard declines (stolen card, closed account) skip the schedule and notify immediately; soft declines (insufficient funds) follow it.
- Notifications are sent once per attempt, tracked by a `NotifiedAt` column; a retried job does not resend.
- Suspended means read-only or blocked per the product, never deleted; data stays for the owner's retention period.
- Reactivation: a successful payment on any open invoice of the subscription sets `active` with `WHERE "Status" IN ('past_due','suspended')`, cancels pending attempts, and does not re-bill periods that were skipped while suspended, unless the owner says so.
- The customer can update the payment method and trigger an immediate retry; that counts as an attempt and is rate-limited.

### Advanced — adds

- Retry timing and decline-code strategy are data, not code, so support can tune them per plan.
- Dunning outcome metrics (recovered %, time to recover) are emitted per run.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Customer pays manually between two retries | The next retry finds the invoice paid and does nothing; attempt row marked `skipped` |
| Provider webhook "paid" arrives after we suspended | Reactivation path runs; no double charge, no second invoice |
| Two retries due at once for the same invoice (job rerun) | Unique `(InvoiceId, AttemptNumber)` and idempotency key: one charge |
| Retry lands on Friday night or a holiday | Schedule is in calendar days; the owner may shift to a business day; default is no shift |
| Subscription canceled during grace period | Pending attempts cancelled; the invoice stays open for collection or is voided per the owner |
| Plan with cancel-at-period-end that fails its last renewal | No renewal was due, so no dunning; the status goes to `canceled` |
| Old `past_due` rows from before this feature | A one-time migration creates their first attempt row; no immediate burst of charges |
| Data at 100×: 50k failures after a gateway outage | Gateway-outage errors are not declines: attempts are rescheduled without counting against the limit; jobs run in batches with a rate cap |
| Twice / parallel: reactivation webhook and retry job at once | Conditional status update lets one transition win; the other is a no-op |

## Example — Standard, Bun + Hono + Drizzle

```ts
export const RetryDays = [1, 3, 7]

export async function CairoPlusDays(Tx: TTx, From: Date, Days: number) {
  const Rows = await Tx.execute<{ At: Date }>(sql`
    SELECT ((${From}::timestamptz AT TIME ZONE 'Africa/Cairo') + make_interval(days => ${Days})) AT TIME ZONE 'Africa/Cairo' AS "At"`)
  return Rows[0].At
}

export async function ScheduleDunning(Tx: TTx, Invoice: TInvoice, FirstFailureAt: Date) {
  const Attempts = []
  for (const [I, Days] of RetryDays.entries()) {
    Attempts.push({ TenantId: Invoice.TenantId, InvoiceId: Invoice.Id, AttemptNumber: I + 1, ScheduledAt: await CairoPlusDays(Tx, FirstFailureAt, Days), Status: "scheduled" })
  }
  await Tx.insert(DunningAttempts).values(Attempts).onConflictDoNothing()
  await SetStatus(Tx, Invoice.SubscriptionId, "active", "past_due")
}

export async function RunDueAttempts(Db: TDb, Now: Date) {
  const Due = await Db.select({ Id: DunningAttempts.Id }).from(DunningAttempts)
    .where(and(eq(DunningAttempts.Status, "scheduled"), lte(DunningAttempts.ScheduledAt, Now)))
    .limit(100)
  for (const { Id } of Due) {
    await Db.transaction(async (Tx) => {
      const [Attempt] = await Tx.select().from(DunningAttempts)
        .where(and(eq(DunningAttempts.Id, Id), eq(DunningAttempts.Status, "scheduled"))).for("update", { skipLocked: true })
      if (Attempt) await ProcessAttempt(Tx, Attempt)
    })
  }
}
```

`ProcessAttempt` re-reads the invoice, returns when it is paid, charges with key `${InvoiceId}:${AttemptNumber}`, and on the last failure calls `SetStatus(…, "past_due", "suspended")`.

## Verify

- [ ] `[M]` Running the retry job twice charges once per attempt.
- [ ] `[S]` Failure moves `active → past_due`, schedules three attempts; the last failure suspends.
- [ ] `[S]` Payment while suspended reactivates and cancels pending attempts.
- [ ] `[S]` One email per attempt even when the job is rerun.
- [ ] `[S]` Gateway outage (5xx) does not burn an attempt.

## Pitfalls

- **Retry job charges without checking the invoice again** → paid customers charged twice → re-read under lock.
- **Counting provider outages as declines** → good customers suspended → classify errors.
- **Suspending by deleting access data** → no way back → status only.
- **Email sent inside the retried transaction** → duplicate emails → `NotifiedAt` flag.

## Related

`domains/billing/subscriptions.md` · `backend/reliability/background-jobs.md` · `backend/reliability/idempotency.md` · `backend/reliability/outbound-calls.md`
