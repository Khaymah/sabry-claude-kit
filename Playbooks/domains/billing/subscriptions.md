# Subscriptions and billing runs

- **Situation:** plans, subscribe, renew every month/year, cancel, "اشتراك شهري", recurring invoices, a job that bills customers each period.
- **Skip when:** a provider (Stripe Billing, Paymob subscriptions) owns the schedule and we only mirror its webhooks. Then store its ids and status as received.
- **Decision:** a subscription is a row with a status machine and a `NextBillingAt`; a billing run creates at most one invoice per `(SubscriptionId, PeriodStart)`, enforced by a unique index, so reruns and parallel workers cannot bill a period twice. A status name, period unit or rounding rule the owner stated or the project already uses wins over the defaults below.

## Levels

| Level | Pick when |
|---|---|
| Minimum | One plan, manual or provider-driven renewal, a handful of customers |
| Standard | Our own billing run, several plans, cancel at period end, real payments |
| Advanced | Multi-currency, add-ons, usage billing, thousands of subscriptions per run |

## Rules

### Minimum — always, never cut

- `Subscriptions` carries `TenantId`, `PlanId`, `Status`, `CurrentPeriodStart`, `CurrentPeriodEnd`, `CancelAtPeriodEnd boolean`. Every query filters by tenant (`backend/data/multi-tenancy.md`).
- Plan price is copied onto the subscription (`PriceMinor`, `Currency`) at subscribe time; changing the plan later never changes existing subscriptions silently.
- Status changes only through one function that checks the allowed transition and writes it with `UPDATE … WHERE "Status" = $from RETURNING`, never read-then-write.
- Unique index `Invoices (SubscriptionId, PeriodStart)` where the invoice is a subscription invoice. This is the guard, not an `if`.
- A tenant has at most one live subscription per plan: partial unique index on `(TenantId, PlanId) WHERE "Status" IN ('trialing','active','past_due')`.

### Standard — adds

- Default statuses: `trialing → active → past_due → suspended → canceled`, plus `active → canceled` at period end. Anything else is rejected.
- Cancel sets `CancelAtPeriodEnd = true`; access continues to `CurrentPeriodEnd`; the billing run flips it to `canceled` instead of renewing. Immediate cancel is a separate, explicit action.
- Billing run lists due ids in batches, then each per-subscription transaction re-selects its row with `FOR UPDATE SKIP LOCKED`, re-checks status and due time, and reads `CancelAtPeriodEnd` only after the lock; one transaction per subscription so one failure does not roll back the rest (`backend/reliability/background-jobs.md`).
- Period end is computed from the previous `CurrentPeriodEnd`, never from `now()`, so a late run does not shift the cycle. Month math clamps the day (Jan 31 + 1 month = Feb 28/29) and keeps an `AnchorDay` so March goes back to 31.
- Catch-up: a run that finds `NextBillingAt` several periods behind loops period by period, creating one invoice per missed period in order; after N missed periods (default 3) it stops and marks `past_due` instead of billing a year at once.
- The charge itself is idempotent per invoice (`backend/reliability/idempotency.md`); money rules in `backend/data/money.md`.

### Advanced — adds

- Run is sharded by `Id` hash across workers; a Postgres advisory lock per shard prevents two runs overlapping.
- Price changes are versioned (`PlanPrices` with `EffectiveFrom`); the invoice records the price version it used.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Run was down for 3 days, then starts | Each due subscription bills its missed period(s) once each, in order, with the original period dates, not today's |
| Subscribe on the 31st, monthly | Periods end on the last day of shorter months; `AnchorDay = 31` restores it |
| Cairo midnight: `CurrentPeriodEnd` stored as `timestamptz` UTC | "Due today" is computed in `Africa/Cairo`, so a 23:30 Cairo renewal is not billed a day early or late |
| Customer cancels one second before renewal | Renewal row locked; the cancel flag is read after the lock, so the run sees it and does not bill |
| Cancel then resubscribe the same plan before period end | Clears `CancelAtPeriodEnd` on the live row; no second subscription (partial unique index) |
| Plan archived while subscribers exist | Existing subscriptions keep renewing at their stored price; new subscribes are refused |
| Old subscriptions without `AnchorDay` | Migration backfills it from `CurrentPeriodStart`; the run never crashes on null |
| Data at 100×: 500k subscriptions due in one night | Batches of a few hundred with `SKIP LOCKED` on index `(Status, NextBillingAt)`; run is resumable, memory flat |
| Twice / parallel: two workers (or a rerun) hit the same period | The second insert fails on the unique `(SubscriptionId, PeriodStart)`; it logs and moves on, no second invoice, no second charge |

## Example — Standard, Bun + Hono + Drizzle

```ts
export const Invoices = pgTable("Invoices", {
  ...BaseColumns,
  TenantId: uuid("TenantId").notNull(),
  SubscriptionId: uuid("SubscriptionId"),
  PeriodStart: timestamp("PeriodStart", { withTimezone: true }),
  TotalMinor: bigint("TotalMinor", { mode: "bigint" }).notNull(),
}, (T) => [
  uniqueIndex("InvoicesSubscriptionPeriod").on(T.SubscriptionId, T.PeriodStart).where(sql`${T.SubscriptionId} IS NOT NULL`),
])

export async function BillDue(Db: TDb, Now: Date) {
  const Due = await Db.select({ Id: Subscriptions.Id }).from(Subscriptions)
    .where(and(eq(Subscriptions.Status, "active"), lte(Subscriptions.NextBillingAt, Now)))
    .limit(200)
  for (const { Id } of Due) await Db.transaction((Tx) => BillOnePeriod(Tx, Id, Now))
}

async function BillOnePeriod(Tx: TTx, SubId: string, Now: Date) {
  const [Sub] = await Tx.select().from(Subscriptions)
    .where(and(eq(Subscriptions.Id, SubId), eq(Subscriptions.Status, "active"), lte(Subscriptions.NextBillingAt, Now)))
    .for("update", { skipLocked: true })
  if (!Sub) return
  if (Sub.CancelAtPeriodEnd) return SetStatus(Tx, Sub.Id, "active", "canceled")
  const Inserted = await Tx.insert(Invoices).values({
    TenantId: Sub.TenantId, SubscriptionId: Sub.Id, PeriodStart: Sub.CurrentPeriodEnd, TotalMinor: Sub.PriceMinor,
  }).onConflictDoNothing().returning({ Id: Invoices.Id })
  if (Inserted.length === 0) return
  await AdvancePeriod(Tx, Sub)
}
```

`SetStatus` is the single transition function: `UPDATE … SET "Status" = $to WHERE "Id" = $id AND "Status" = $from`, zero rows means the transition was refused.

Other stacks: the same unique index plus `INSERT … ON CONFLICT DO NOTHING` works in any SQL stack.

## Verify

- [ ] `[M]` Run the billing job twice, and in two parallel processes: exactly one invoice per period.
- [ ] `[M]` Subscribe twice to the same plan in parallel: one live row.
- [ ] `[S]` Stop the job for 3 periods, restart: 3 invoices with consecutive period dates; at the cap it stops and marks `past_due`.
- [ ] `[S]` Jan 31 monthly gives Feb 28, then Mar 31.
- [ ] `[A]` 100k due rows complete in resumable batches; killing the worker mid-run loses nothing and duplicates nothing.

## Pitfalls

- **Period end computed from `now()`** → cycle drifts after every late run → derive from the previous period end.
- **Check "already billed?" in JS** → two workers both pass → unique index.
- **One transaction for the whole run** → one bad row blocks everyone → one transaction per subscription.
- **Plan price read live at renewal** → price change silently re-bills old customers → price copied on the subscription.

## Related

`domains/billing/proration.md` · `domains/billing/dunning.md` · `domains/billing/invoice-splits.md` · `backend/reliability/background-jobs.md` · `backend/data/money.md`
