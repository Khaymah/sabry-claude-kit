# Data retention and deletion

- **Situation:** "delete my account and data", personal data deletion requests, "how long do we keep invoices", purge old logs or inactive accounts, anonymise a user, GDPR-style requests, deleted data still in backups.
- **Skip when:** the app stores no personal data (rare) — otherwise this always applies, at least as a written policy.
- **Decision:** every table has a retention class. Personal data is deleted or anonymised on request or when its purpose ends; financial and legal records are kept, with the person's identity reduced to what the law requires. Purges are scheduled, batched, audited jobs, never ad-hoc SQL.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Any app with users: retention table, account deletion that anonymises, no personal data in logs |
| Standard | Real customers: + scheduled purge jobs, deletion request workflow, backup policy, tested |
| Advanced | Regulated or large tenants: per-tenant retention, legal hold, deletion certificates, key-based erasure |

## Rules

### Minimum — always, never cut

- Write a retention table in the project docs: each table or log, what it holds, keep how long, why, and action at expiry (`Delete`, `Anonymise`, `Keep`). A table missing from it is a review failure.
- Financial records (invoices, payments, journal entries, tax documents) are never hard-deleted by a user request; they are kept for the legal period and the personal fields are minimised, not removed. Egyptian rule: commonly 5 years for commercial books and 5 years for tax records — treat as a note to verify with the client's accountant, and make the period a setting, not a constant.
- Deleting an account anonymises, in one transaction: name, email, phone, address, avatar and free-text become irreversible placeholders (`Deleted user 4f2a`), the login is revoked (sessions, API keys, OTPs, push tokens), the email hash for duplicate checks is dropped unless needed for fraud.
- Rows kept for law keep their foreign key to the anonymised user, so totals and reports stay correct.
- Personal data never goes to logs, error reports, analytics events or URLs; where unavoidable it is masked (`m***@mail.com`).
- Every deletion or anonymisation is audit-logged with who, what, and why, without copying the deleted values (`backend/data/audit-log.md`).

### Standard — adds

- Deletion requests are rows (`DeletionRequests`: `UserId`, `Status`, `RequestedAt`, `ScheduledFor`) with a 7–30 day grace period, cancellable by signing in; a job executes them.
- Purge jobs run in batches (e.g. 1,000 ids per transaction, ordered by id, loop until none), idempotent, with a per-run limit and a metric of deleted rows (`backend/reliability/background-jobs.md`).
- Delete in dependency order or let `ON DELETE CASCADE`/`SET NULL` do it; decide per foreign key, and test with real data shapes.
- Files and derived data are included: uploads by key prefix (`backend/files/uploads.md`), search index entries, caches, email-provider and analytics copies. A checklist table lists every place a user's data lands.
- Backups: documented retention (e.g. 35 days), encrypted, and deleted data ages out with them. On restore, a replay of the deletion log (`DeletionLog` of user ids and dates) re-applies deletions before the system serves traffic.
- Soft-deleted rows (`backend/data/soft-delete.md`) are not "deleted for privacy"; they need the purge job at the end of their window.
- Inactive accounts: warn by email, then anonymise after the stated period.

### Advanced — adds

- Legal hold: a flag on a user or tenant that suspends purge and deletion, with who set it and why.
- Per-tenant retention settings within allowed bounds; tenant offboarding exports then deletes (`backend/data/multi-tenancy.md`).
- Crypto-shredding: sensitive columns encrypted with a per-user key; deleting the key erases the data, including in backups.
- A signed deletion certificate stored for the request.

## Edge cases

| Case | Expected behaviour |
|---|---|
| User with invoices requests deletion | Account anonymised, invoices kept with the customer name replaced by the retained legal minimum (name and tax id if the law requires it, else placeholder) |
| Email reused after deletion | New signup works; no link to the old anonymised row |
| Deletion requested twice | One request row (unique active per user); the second returns the existing one |
| User signs in during grace period | Request cancelled, audited |
| Purge job interrupted at batch 40 of 200 | Next run continues from the remaining rows; no row half-anonymised because each batch is a transaction |
| Backup restored from 20 days ago | Deletion log replayed before reopening; deleted users stay anonymised |
| Anonymised user appears in an audit row or an old export | Audit keeps ids only; exports already given out are outside our control and noted in the policy |
| Retention period shortened by the client | Applies to new expiry calculations; a one-off job handles old rows in batches |
| Legal period depends on the document date | Compute expiry from the document's own date in `Africa/Cairo`, not from the deletion request date |
| 100×: 50M log rows to purge | Partition by month and drop whole partitions, or delete in indexed batches off-peak; never one `DELETE` |
| Twice / parallel: two purge workers | Advisory lock or `FOR UPDATE SKIP LOCKED` batches; no row processed twice, counts correct |

## Example — Standard, Bun + Hono + Drizzle

```ts
export async function AnonymiseUser(Tx: TTx, UserId: string) {
  const Tag = UserId.slice(0, 4)
  const [User] = await Tx.update(Users).set({
    Name: `Deleted user ${Tag}`, Email: `deleted-${UserId}@invalid.local`, Phone: null,
    Address: null, AvatarKey: null, AnonymisedAt: new Date(), Status: "Anonymised",
  }).where(and(eq(Users.Id, UserId), isNull(Users.AnonymisedAt))).returning({ Id: Users.Id })
  if (!User) return false
  await Tx.delete(Sessions).where(eq(Sessions.UserId, UserId))
  await Tx.delete(ApiKeys).where(eq(ApiKeys.UserId, UserId))
  await Tx.delete(PushTokens).where(eq(PushTokens.UserId, UserId))
  await Tx.update(Invoices).set({ CustomerName: `Deleted customer ${Tag}`, CustomerPhone: null }).where(eq(Invoices.CustomerId, UserId))
  await Tx.insert(DeletionLog).values({ UserId, DeletedAt: new Date() })
  await WriteAudit(Tx, "User.Anonymised", { UserId })
  return true
}

export async function RunDeletionRequests() {
  let Count = 0
  do {
    Count = await db.transaction(async (Tx) => {
      const Due = await Tx.select({ UserId: DeletionRequests.UserId }).from(DeletionRequests)
        .where(and(eq(DeletionRequests.Status, "Pending"), lte(DeletionRequests.ScheduledFor, new Date())))
        .orderBy(DeletionRequests.UserId).limit(100).for("update", { skipLocked: true })
      for (const { UserId } of Due) {
        await AnonymiseUser(Tx, UserId)
        await Tx.update(DeletionRequests).set({ Status: "Done" }).where(eq(DeletionRequests.UserId, UserId))
        await Tx.insert(Outbox).values({ Type: "PurgeUserFiles", Payload: { UserId } })
      }
      return Due.length
    })
  } while (Count > 0)
}
```

Each batch is one transaction: `SKIP LOCKED` lets two workers take different users, and the file purge is queued through the outbox so it commits with the anonymisation. Anonymisation is idempotent (`AnonymisedAt IS NULL`), so a retry is safe.

Other stacks: Laravel scheduled command with `chunkById`; Prisma `updateMany` in id-range batches.

## Verify

- [ ] `[M]` After deletion, no query of the users table or logs returns the old name, email or phone.
- [ ] `[M]` Invoices of the deleted user still exist and totals are unchanged.
- [ ] `[S]` Running the purge twice deletes nothing the second time; killing it mid-run and restarting finishes the job.
- [ ] `[S]` Restoring a backup then replaying `DeletionLog` leaves deleted users anonymised.
- [ ] `[A]` A user under legal hold is skipped by the purge job and the skip is logged.

## Pitfalls

- **Hard-deleting a user with invoices** → broken ledgers, legal exposure → anonymise and keep.
- **Logging request bodies** → personal data lives forever in log storage → mask, short log retention.
- **One huge `DELETE`** → long locks, replication lag → batches.
- **Ignoring files, search index, mail provider** → data survives in copies → one checklist of every place.
- **Retention period hard-coded** → law or client changes need a deploy → setting per tenant or global.

## Related

`backend/data/soft-delete.md` · `backend/data/audit-log.md` · `backend/reliability/background-jobs.md` · `backend/files/uploads.md` · `backend/data/multi-tenancy.md` · `backend/data/time-zones.md`
