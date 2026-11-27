# Wallets and balances

- **Situation:** customer or merchant wallet, top-up, pay from balance, transfer between wallets, hold an amount until an order completes, monthly statement, "الرصيد مش مظبوط".
- **Skip when:** the balance lives at a provider and we only display it. Store what the provider returns and stop.
- **Decision:** a wallet is a signed append-only ledger plus a cached balance changed in the same transaction. The ledger mechanics are `backend/data/money.md` (Advanced); this file adds what a wallet needs on top. Names, codes and status values the project already uses win over the defaults here.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Internal credit balance, top-up and spend only, one currency |
| Standard | Customers see and spend balance; transfers, statements, refunds back to wallet |
| Advanced | Holds/authorizations, merchant wallets, regulated e-money, several currencies |

## Rules

### Minimum — always, never cut

- One `Wallets` row per `(TenantId, OwnerId, Currency)`, unique. `Balance bigint NOT NULL CHECK ("Balance" >= 0)`.
- Every change writes a `LedgerEntries` row and updates `Balance` in one transaction: `SET "Balance" = "Balance" - $1 WHERE "Id" = $2 AND "Balance" - "Held" >= $1 RETURNING`, where `Held` is the cached sum of open holds (0 without holds). No row back is `409 INSUFFICIENT_FUNDS` (default code; keep the project's).
- Top-up, spend and transfer take an idempotency key (`backend/reliability/idempotency.md`), stored on the entry with a unique `(TenantId, WalletId, IdempotencyKey)`, never a global key. The caller must own the source wallet or hold the permission; a unique violation is mapped to returning the first result.
- Top-up credits only after the provider confirms and amount plus currency match; never from the redirect page.
- Entries are never updated or deleted. A wrong entry is fixed by a reversing entry that references it.

### Standard — adds

- Transfer locks both wallets with `SELECT … FOR UPDATE ORDER BY "Id"` in one transaction (`backend/data/concurrency.md`), then writes two entries sharing one `TransferId`. Debit and credit are the same transaction, always.
- Transfer to self, zero, negative or fractional-minor amount is `400`. Different currencies is `400`. Different tenants is `404` unless the project defines cross-tenant transfers.
- Each entry stores `BalanceAfter`. A nightly check recomputes `SUM(Amount)` per wallet and alerts on any difference from `Balance`; it never fixes it.
- Statement per period = opening balance (last `BalanceAfter` before the period start) + entries in `[start, end)` + closing balance, with the period cut at midnight Africa/Cairo (`backend/data/time-zones.md`). A closed period is stored, not regenerated.
- Refund to wallet is a credit entry referencing the original spend; total credited never exceeds the spend.
- Wallet status (`Active`, `Frozen`, `Closed`): `Frozen` blocks debits only; a credit needs a status other than `Closed`. `Closed` requires zero balance and zero open holds.

### Advanced — adds

- A hold is a row in `WalletHolds (Id, WalletId, Amount, Status, ExpiresAt)`; `Available = Balance - Held`, with `Held` kept in step with open holds in the same transaction. Placing a hold is one atomic `UPDATE` that checks `Available`, not a read then write.
- Capture turns a hold into a debit entry for an amount at most the hold; the remainder is released. Capture and release are conditional on `Status = 'Open'`, so each happens once.
- An expiry job releases lapsed holds with `FOR UPDATE SKIP LOCKED`; a capture arriving after expiry is `409 HOLD_EXPIRED`.
- Merchant wallets separate `Pending` (not yet payable) from `Available`; moving between them is an entry, never a column edit.
- Daily limits and per-transaction limits are checked in the same transaction as the debit, against entries, not a separate counter.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Spend exactly equal to the balance | Succeeds; balance is 0, never negative |
| Two transfers A→B and B→A at once | Both lock in `Id` order; no deadlock; both complete or fail cleanly |
| Top-up webhook arrives twice, or after the user retried | One credit; the second matches the unique provider reference and returns the first result |
| Top-up confirmed for a Closed wallet | Held as `Unapplied` for support; not credited, not lost |
| Hold placed, then a spend uses the same funds | Spend sees `Available`, so it fails if the hold covers the balance |
| Capture larger than the hold | `409`; capture never exceeds the hold, no silent top-up |
| Statement for a period with no entries | Opening equals closing; still produced |
| Entry at 23:59:59 Cairo and the job runs in UTC | Lands in the Cairo day it happened in |
| Data at 100×: wallet with tens of millions of entries | Balance read from the column; statements page by `(WalletId, CreatedAt, Id)` index; the full sum runs only in the nightly check |
| Twice / parallel: same spend request sent twice | Second hits the unique idempotency key and returns the first entry; one debit |
| Old wallets with a negative cached balance before the `CHECK` | Migration lists them for review; the `CHECK` is added `NOT VALID`, then validated after correction |

## Example — Standard, Bun + Hono + Drizzle

```ts
export async function TransferBetweenWallets(TenantId: string, ActorId: string, FromId: string, ToId: string, Amount: bigint, Key: string) {
  if (FromId === ToId || Amount <= 0n) throw new AppError("WALLET_TRANSFER_INVALID", 400)
  return db.transaction(async (Tx) => {
    const Locked = await Tx.select().from(Wallets)
      .where(and(eq(Wallets.TenantId, TenantId), inArray(Wallets.Id, [FromId, ToId])))
      .orderBy(Wallets.Id).for("update")
    if (Locked.length !== 2 || Locked[0].Currency !== Locked[1].Currency) throw new AppError("WALLET_TRANSFER_INVALID", 400)
    if (Locked.find((W) => W.Id === FromId)?.OwnerId !== ActorId) throw new AppError("FORBIDDEN", 403)
    const Existing = await Tx.select().from(LedgerEntries)
      .where(and(eq(LedgerEntries.TenantId, TenantId), eq(LedgerEntries.WalletId, FromId), eq(LedgerEntries.IdempotencyKey, Key))).limit(1)
    if (Existing.length) return { TransferId: Existing[0].TransferId }
    const Debited = await Tx.update(Wallets)
      .set({ Balance: sql`${Wallets.Balance} - ${Amount}` })
      .where(and(eq(Wallets.Id, FromId), eq(Wallets.Status, "Active"), sql`${Wallets.Balance} - ${Wallets.Held} >= ${Amount}`))
      .returning({ Balance: Wallets.Balance })
    if (!Debited.length) throw new AppError("INSUFFICIENT_FUNDS", 409)
    const Credited = await Tx.update(Wallets)
      .set({ Balance: sql`${Wallets.Balance} + ${Amount}` })
            .where(and(eq(Wallets.Id, ToId), ne(Wallets.Status, "Closed"))).returning({ Balance: Wallets.Balance })
    if (!Credited.length) throw new AppError("WALLET_TRANSFER_INVALID", 400)
    const TransferId = crypto.randomUUID()
    await Tx.insert(LedgerEntries).values([
      { TenantId, WalletId: FromId, Amount: -Amount, BalanceAfter: Debited[0].Balance, TransferId, IdempotencyKey: Key },
      { TenantId, WalletId: ToId, Amount, BalanceAfter: Credited[0].Balance, TransferId, IdempotencyKey: `${Key}:in` },
    ])
    return { TransferId }
  })
}
```

Other stacks: the same two rules apply anywhere: lock both rows in id order, conditional `UPDATE` for the debit.

## Verify

- [ ] `[M]` 50 parallel spends of 1 against a balance of 10: exactly 10 succeed, balance 0, 10 entries.
- [ ] `[M]` Replaying a spend with the same key returns the same entry and debits once.
- [ ] `[S]` 100 parallel A→B and B→A transfers finish with no deadlock and total money unchanged.
- [ ] `[S]` The nightly check finds `SUM(Amount) = Balance` for every wallet.
- [ ] `[A]` 20 parallel holds on a wallet that covers 10: exactly 10 succeed; capture twice debits once.

## Pitfalls

- **Reading the balance, checking in JS, then updating** → two spends both pass → conditional `UPDATE … RETURNING`.
- **Debit and credit in separate transactions** → money vanishes on a crash between them → one transaction.
- **Locking in request order** → A→B and B→A deadlock → `ORDER BY "Id"`.
- **Editing `Balance` by hand to fix a bug** → ledger and balance diverge forever → reversing entry.
- **Statement regenerated from today's entries** → a closed period changes after the fact → store it at close.

## Related

`backend/data/money.md` · `backend/data/concurrency.md` · `backend/reliability/idempotency.md` · `backend/data/audit-log.md` · `domains/fintech/reconciliation.md` · `domains/billing/refunds.md`
