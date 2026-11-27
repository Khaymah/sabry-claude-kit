# Payouts to merchants and drivers

- **Situation:** paying out earnings to merchants, drivers, sellers or affiliates, weekly or daily settlement, minimum payout, holding period, bank transfer failed, changed bank account, "الدفعة اتصرفت مرتين".
- **Skip when:** the payment provider splits and pays recipients itself and we never hold their money. Store its payout ids and statuses as received.
- **Decision:** a payout is a row that moves an exact amount out of the recipient's ledger balance, created once per balance under a unique key, sent through an idempotent bank or provider call, and settled by its final status; a failure puts the money back with an entry. Thresholds, periods and cooling days the owner stated win over the defaults here.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Manual payouts by an admin from a list, few recipients |
| Standard | Scheduled batches, threshold, holding period, failure handling |
| Advanced | High volume, provider bulk files, approvals, several currencies |

## Rules

### Minimum — always, never cut

- Earnings sit in the recipient's wallet ledger (`domains/fintech/wallets.md`). A payout is a debit entry plus a `Payouts` row in one transaction; the balance never goes negative.
- `Payouts` carries `RecipientId`, `AmountMinor`, `Currency`, `BankDetailsSnapshot` (copied at creation), `Status`, `PeriodKey`, with unique `(RecipientId, Currency, PeriodKey)`. A second run for the same period hits the constraint and does nothing.
- Statuses only move forward: `Pending → Submitted → Paid` or `→ Failed`. Each transition is a conditional `UPDATE … WHERE "Status" = <expected>`.
- The call to the bank or provider carries the payout `Id` as its idempotency key (`backend/reliability/outbound-calls.md`). A timeout leaves the payout `Submitted`; it is never resent as new.
- Bank account numbers and IBANs are encrypted at rest and masked in every response and log; only the last 4 digits are shown.

### Standard — adds

- The batch job selects recipients with `Available >= MinimumPayout` and creates payouts in one statement per recipient, each in its own transaction, under an advisory lock (`backend/reliability/background-jobs.md`). One bad recipient never stops the batch.
- Only amounts older than the holding period are payable: sum entries with `CreatedAt <= now() - HoldingDays`, minus what was already paid out. Refund and chargeback windows are the reason; the owner sets the days.
- Below the threshold the balance carries over; it is never rounded up, and never paid as a tiny transfer that costs more in fees.
- Failure (`Failed`, returned by the bank days later, closed account): write a credit entry referencing the payout and mark it `Failed` in one transaction. Funds return to `Available` once, even if the failure callback repeats. The recipient is flagged and notified; the payout is not auto-retried to the same details.
- Bank details change: the new details are `Pending` until verified (OTP to the owner, or the owner's own approval step) and cannot receive a payout for the cooling period (default 72 hours, or the owner's value). Any payout created in that window uses the old verified details, or waits. Change events go to the audit log and to the old contact point (`backend/data/audit-log.md`).
- Payout amount minus provider fee is computed by one function; the fee is its own ledger entry, not a hidden subtraction.
- Roles: creating batches and approving them are separate permissions (`backend/auth/rbac.md`).

### Advanced — adds

- Batches over a limit need a second approver before `Submitted`; approval and submission are separate rows with actors.
- Bulk bank files carry a per-line reference equal to the payout `Id`; the response file is matched line by line, and unmatched lines go to `domains/fintech/reconciliation.md`.
- Per-recipient daily and monthly payout caps are checked against payout rows in the creating transaction.
- Currency cut-offs: a payout created after the bank's daily cut-off is dated for the next banking day; the date is stored.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Job triggered twice, or by two instances | Advisory lock plus unique `PeriodKey`: one payout per recipient per period |
| Balance exactly the threshold | Paid; the rule is `>=` and written in the test |
| Earnings arrive while the batch runs | Not included; the payout sums entries up to a cutoff timestamp fixed at the start |
| Refund lands after the payout was created | Recipient balance can go negative only if the project allows debt; otherwise the refund is netted from the next payout, never reversed on the bank |
| Bank returns the transfer 3 days later | Funds credited back once; status `Failed`, `Paid` rows are never edited, a `Returned` entry is added |
| Provider call times out | Payout stays `Submitted`; a status check job resolves it by the idempotency key |
| Details changed 1 hour before the batch | Payout uses the verified old details or waits out the cooling period; never the unverified new ones |
| Recipient with zero verified bank details | Skipped with a reason row; balance stays |
| Data at 100×: 200k recipients in one batch | Process in pages by `RecipientId`, one transaction each; the run is resumable and reports counts, not one giant transaction |
| Twice / parallel: Admin clicks "pay now" while the scheduled job runs | The second sees the unique key or the status guard and returns the existing payout |
| Friday or holiday in Egypt | Submitted but dated for the next banking day; recipients are told the real date |

## Example — Standard, Bun + Hono + Drizzle

```ts
export async function CreatePayout(RecipientId: string, Currency: string, PeriodKey: string, Cutoff: Date, Minimum: bigint) {
  return db.transaction(async (Tx) => {
    const [Wallet] = await Tx.select().from(Wallets)
      .where(and(eq(Wallets.OwnerId, RecipientId), eq(Wallets.Currency, Currency))).for("update")
    const Details = await Tx.select().from(BankDetails)
      .where(and(eq(BankDetails.OwnerId, RecipientId), eq(BankDetails.Status, "Verified"), lte(BankDetails.VerifiedAt, sql`now() - interval '72 hours'`)))
      .orderBy(desc(BankDetails.VerifiedAt)).limit(1)
    if (!Wallet || !Details.length) return null
    const Payable = await PayableBefore(Tx, Wallet.Id, Cutoff)
    const Amount = Payable < Wallet.Balance ? Payable : Wallet.Balance
    if (Amount < Minimum) return null
    const [Row] = await Tx.insert(Payouts)
      .values({ RecipientId, AmountMinor: Amount, Currency, PeriodKey, Status: "Pending", BankDetailsSnapshot: Details[0].Encrypted })
      .onConflictDoNothing().returning()
    if (!Row) return null
    await Tx.update(Wallets).set({ Balance: sql`${Wallets.Balance} - ${Amount}` }).where(eq(Wallets.Id, Wallet.Id))
    await Tx.insert(LedgerEntries).values({ WalletId: Wallet.Id, Amount: -Amount, ReferenceType: "Payout", ReferenceId: Row.Id, BalanceAfter: Wallet.Balance - Amount })
    return Row
  })
}

export async function FailPayout(PayoutId: string) {
  return db.transaction(async (Tx) => {
    const [Row] = await Tx.update(Payouts).set({ Status: "Failed" })
      .where(and(eq(Payouts.Id, PayoutId), inArray(Payouts.Status, ["Pending", "Submitted", "Paid"]))).returning()
    if (!Row) return
    await CreditWallet(Tx, Row.RecipientId, Row.Currency, Row.AmountMinor, "PayoutReturn", Row.Id)
  })
}
```

Other stacks: the unique `(RecipientId, Currency, PeriodKey)` and the status-guarded `UPDATE` carry the whole idea.

## Verify

- [ ] `[M]` Running the job twice for one period creates one payout per recipient.
- [ ] `[M]` Logs and API responses for a recipient show only the last 4 digits of the account.
- [ ] `[S]` Two instances running the job at once pay each recipient once.
- [ ] `[S]` A failure callback delivered three times credits the wallet once.
- [ ] `[S]` Bank details changed now are not used by a payout created within the cooling period.
- [ ] `[A]` A bulk response file with one missing line leaves exactly that payout `Submitted` and raises a reconciliation item.

## Pitfalls

- **Debiting the wallet only after the bank confirms** → the same balance is paid twice in parallel → debit first, return on failure.
- **Sending the bank call inside the DB transaction** → a rollback after the money left → commit `Pending`, then call.
- **Reading bank details at send time** → a changed account receives old money → snapshot at creation.
- **Failure handler that credits without a status guard** → duplicate returns mint money → conditional `UPDATE` first.
- **Counting the threshold on total balance** → unreleased funds get paid → use the holding-period amount.

## Related

`domains/fintech/wallets.md` · `domains/fintech/reconciliation.md` · `backend/data/money.md` · `backend/reliability/background-jobs.md` · `backend/reliability/idempotency.md` · `backend/reliability/outbound-calls.md` · `backend/auth/rbac.md`
