# Payment reconciliation

- **Situation:** matching our payments and refunds with the gateway's settlement report or file, daily reconciliation, "المبالغ مش متطابقة مع البوابة", fees, missing or extra transactions, settlement differences.
- **Skip when:** the gateway is the only record and we store nothing about payments beyond its ids.
- **Decision:** a daily job loads the provider's report into its own table, matches each line to our payments by provider reference, classifies it, and raises alerts. It reads our money rows and never edits them; a difference is fixed by an adjustment entry a person approves. Provider file formats, cut-off times and fee terms are the contract's; the owner's stated tolerance wins over the defaults.

## Levels

| Level | Pick when |
|---|---|
| Minimum | One gateway, a few payments a day, manual comparison in a sheet |
| Standard | Daily automated job, states, fee check, alerts |
| Advanced | Several gateways or currencies, high volume, payout and bank statement matching |

## Rules

### Minimum — always, never cut

- Never update or delete a payment, ledger or order row to make totals agree. The only fix is a new adjustment entry referencing the line, with a reason and an actor (`backend/data/audit-log.md`).
- Store the provider report as received: `SettlementLines (Provider, ReportDate, ProviderRef, AmountMinor, FeeMinor, Currency, RawJson)` with unique `(Provider, ProviderRef, LineType)`. Loading the same file twice adds nothing.
- Compare integers in minor units plus currency (`backend/data/money.md`). A provider that sends decimal strings is converted by its adapter.
- Every line ends in a state. A line with no state is a bug, not "pending forever".

### Standard — adds

- States: `Matched` (reference, amount and currency agree), `Mismatched` (reference found, amount, currency or status differs), `MissingAtProvider` (ours, not in the report after the expected delay), `UnknownToUs` (in the report, not ours), `Adjusted` (closed by an adjustment entry).
- Match on the provider reference first, then our idempotency or order reference; never match on amount and time alone.
- Net settlement = sum of captured amounts − refunds − fees − chargebacks. The job checks the report total against the sum of its lines and against the bank deposit when known. Fees are checked against the contract's rate with a stated rounding tolerance; a fee outside it is `Mismatched`.
- Window: a payment is expected in the report within the provider's settlement lag (the owner states T+1, T+2). Missing earlier than that is `Pending`, not an alert.
- Run daily after the provider's report is published, under an advisory lock; resumable and safe to run twice. The report day uses Africa/Cairo for our side and the provider's own timezone for theirs, converted explicitly (`backend/data/time-zones.md`).
- Alerts: any `Mismatched`, `UnknownToUs` or `MissingAtProvider` past its window notifies finance with counts, total difference and a link to the list; zero differences sends nothing noisy but records the run.
- A line is never auto-matched across tenants; the tenant filter applies to our side of every join (`backend/data/multi-tenancy.md`).
- Resolution screens show our row beside the provider's, the difference, and the actions: accept provider (adjustment entry), mark under dispute, or ignore with a reason.

### Advanced — adds

- Per currency totals are reconciled separately; a cross-currency settlement stores the rate used by the provider and compares converted totals within the stated tolerance.
- Bank statement lines are matched to settlement batches the same way, one level up: batch total to deposit.
- Chargebacks and late refunds arrive as new lines in later reports and are matched to the original payment; the original stays `Matched`.
- A monthly close snapshot freezes reconciliation results for the period; later differences are new adjustments dated in the open period.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Report file loaded twice, or corrected and republished | Unique key makes the second load a no-op; a changed line for the same reference is `Mismatched` with both versions kept |
| Payment captured at 23:50 Cairo, settled on the next provider day | Matches by reference regardless of day; only the expected-window check uses dates |
| Provider fee is 2.5% + 3 EGP and rounds differently from ours | Within the stated tolerance (1 piaster per line) is `Matched`; larger is `Mismatched` |
| Refund in the report with no refund on our side | `UnknownToUs`; alert, never an auto-created refund |
| Our payment `Paid` but absent at provider after the lag | `MissingAtProvider`; order is not touched; finance decides |
| Amount differs by exactly the fee (gross vs net reported) | Adapter normalises gross and net explicitly; unnormalised differences are never silenced |
| Currency differs (we charged EGP, provider settled USD) | `Mismatched` with both currencies shown; no conversion by guess |
| Data at 100×: millions of lines per day | Load in batches, match with one set-based `JOIN` on an indexed `ProviderRef`, never a query per line; the job reports counts per state |
| Twice / parallel: Job runs on two instances, or while a person resolves a line | Advisory lock on the run; resolutions use conditional `UPDATE … WHERE "State" = <expected>` so one adjustment per line |
| Payment arrives after the report date it belongs to | Matched in the next run; the earlier alert closes automatically as `Matched` |

## Example — Standard, Bun + Hono + Drizzle

```ts
export async function MatchSettlement(Provider: string, ReportDate: string) {
  return db.transaction(async (Tx) => {
    const Locked = await Tx.execute<{ Ok: boolean }>(sql`SELECT pg_try_advisory_xact_lock(hashtext(${`recon:${Provider}:${ReportDate}`})) AS "Ok"`)
    if (!Locked[0].Ok) return null
    await Tx.execute(sql`
      UPDATE "SettlementLines" AS L SET "State" = CASE
        WHEN P."Id" IS NULL THEN 'UnknownToUs'
        WHEN P."AmountMinor" = L."AmountMinor" AND P."Currency" = L."Currency" THEN 'Matched'
        ELSE 'Mismatched' END,
        "PaymentId" = P."Id"
      FROM "SettlementLines" AS S
      LEFT JOIN "Payments" AS P ON P."ProviderRef" = S."ProviderRef" AND P."Provider" = S."Provider"
      WHERE L."Id" = S."Id" AND L."Provider" = ${Provider} AND L."ReportDate" = ${ReportDate} AND L."State" = 'New'`)
    return Tx.execute(sql`
      SELECT "State", count(*)::int AS "Count", coalesce(sum("AmountMinor"), 0)::text AS "Total"
      FROM "SettlementLines" WHERE "Provider" = ${Provider} AND "ReportDate" = ${ReportDate} GROUP BY "State"`)
  })
}

export async function AdjustLine(LineId: string, ActorId: string, Reason: string) {
  return db.transaction(async (Tx) => {
    const [Line] = await Tx.update(SettlementLines).set({ State: "Adjusted" })
      .where(and(eq(SettlementLines.Id, LineId), eq(SettlementLines.State, "Mismatched"))).returning()
    if (!Line) throw new AppError("RECON_LINE_NOT_OPEN", 409)
    await Tx.insert(Adjustments).values({ LineId, ActorId, Reason, AmountMinor: Line.AmountMinor - (Line.OurAmountMinor ?? 0n) })
  })
}
```

Other stacks: one set-based join per run; classification is data, adjustments are rows.

## Verify

- [ ] `[M]` Loading the same report twice leaves the line count unchanged.
- [ ] `[M]` No code path in the job issues an `UPDATE` or `DELETE` on `Payments`, `LedgerEntries` or `Orders`.
- [ ] `[S]` A seeded set of matched, short, extra and missing lines gets exactly the expected states.
- [ ] `[S]` Two runs at once classify each line once; an alert is sent once.
- [ ] `[A]` A multi-currency report reconciles per currency and flags a rate difference above tolerance.

## Pitfalls

- **Fixing a mismatch by editing the payment amount** → history and audit are gone → adjustment entry.
- **Matching on amount and date** → two equal payments swap places → provider reference.
- **A query per report line** → the job takes hours at volume → one set-based join.
- **Alerting on every unsettled payment** → finance mutes it → alert only past the settlement window.
- **Ignoring gross vs net** → every line is off by the fee → normalise in the adapter.

## Related

`backend/data/money.md` · `backend/data/audit-log.md` · `backend/data/time-zones.md` · `backend/reliability/background-jobs.md` · `domains/fintech/wallets.md` · `domains/fintech/payouts.md` · `domains/billing/refunds.md`
