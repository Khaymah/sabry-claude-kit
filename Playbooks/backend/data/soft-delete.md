# Soft delete, archive and restore

- **Situation:** "delete" buttons, trash and restore, archiving, records referenced by invoices or history, account deletion, data retention, "the client deleted it by mistake".
- **Skip when:** pure join or log tables where a row has no life of its own (a tag link, a session row): delete them.
- **Decision:** business records are soft-deleted (`IsDeleted`, `DeletedAt`, `DeletedBy`) and every read filters through one shared helper; uniqueness ignores deleted rows; personal data that must really go is anonymised or hard-deleted by a purge job after the retention period.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Every business table (owner default): flag + helper + partial unique indexes |
| Standard | Production: restore, cascade rules, purge job |
| Advanced | Regulated data, legal retention, deletion requests across backups |

## Rules

### Minimum — always, never cut

- Columns: `IsDeleted boolean NOT NULL DEFAULT false` (base columns) plus `DeletedAt timestamptz` and `DeletedBy uuid`.
- Every read on a soft-deletable table goes through `NotDeleted(Table)`; never a hand-written `IsDeleted = false` you might forget.
- Unique business keys are partial: `CREATE UNIQUE INDEX … ("Email") WHERE "IsDeleted" = false`.
- Lists, counts, lookups by id and joins all filter; a deleted row returns `404`, not `403`.

### Standard — adds

- Cascade is decided per relation and written in the service: deleting a project soft-deletes its tasks in the same transaction, or is refused while it has active children (`409 HAS_DEPENDENTS`).
- Restore checks uniqueness again: restoring a user whose email is now taken returns `409` and asks for a new value.
- Indexes used by lists are partial `WHERE "IsDeleted" = false`, so deleted rows don't slow queries.
- A purge job hard-deletes or anonymises rows deleted longer than the retention period (from `SystemSettings`), in batches.
- Admin views can include deleted rows explicitly (`IncludeDeleted: true`), behind a permission.

### Advanced — adds

- Account deletion requests: personal fields anonymised immediately (`Name = 'Deleted user'`, email hashed), records kept for accounting; the request logged in the audit log.
- Backups: deleted personal data is gone from backups once their retention passes; the policy is written.
- Archive tables or partitions for old data that must stay queryable but not hot.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Invoice references a soft-deleted product | The invoice keeps its line snapshot (`backend/data/money.md`); the product link shows "deleted product" |
| User re-registers with the email of a deleted account | Allowed by the partial unique index; the new account is separate |
| Delete called twice | Second call is a no-op returning success (`WHERE "IsDeleted" = false` matches nothing, treated as already deleted) |
| Foreign key from an active row to a deleted row | Either cascaded soft delete or refused; never an active row pointing at a hidden parent without a decision |
| Search index or cache holds the deleted row | Deletion emits an event; the index and cache entries are removed |
| 100×: millions of deleted rows | Partial indexes keep live queries fast; purge job trims the table in batches |
| Twice / parallel: delete and update at the same moment | Update's `WHERE` includes `NotDeleted`, so it affects nothing once the delete commits; the user gets 404 |

## Example — Standard, Drizzle

```ts
export const NotDeleted = (T: { IsDeleted: AnyPgColumn }) => eq(T.IsDeleted, false)

export async function DeleteProject(Id: string, ActorId: string) {
  await db.transaction(async (Tx) => {
    const [Project] = await Tx.update(Projects)
      .set({ IsDeleted: true, DeletedAt: sql`now()`, DeletedBy: ActorId })
      .where(and(eq(Projects.Id, Id), NotDeleted(Projects)))
      .returning({ Id: Projects.Id })
    if (!Project) return
    await Tx.update(Tasks)
      .set({ IsDeleted: true, DeletedAt: sql`now()`, DeletedBy: ActorId })
      .where(and(eq(Tasks.ProjectId, Id), NotDeleted(Tasks)))
    await WriteAudit(Tx, { ActorId, Action: "Project.Deleted", EntityType: "Project", EntityId: Id })
  })
}
```

```sql
CREATE UNIQUE INDEX "UsersEmailUnique" ON "Users" ("Email") WHERE "IsDeleted" = false;
CREATE INDEX "TasksProjectActive" ON "Tasks" ("ProjectId", "CreatedAt" DESC) WHERE "IsDeleted" = false;
```

## Verify

- [ ] `[M]` Every query on a soft-deletable table uses `NotDeleted(` (`grep` the service files).
- [ ] `[M]` Unique indexes on business keys are partial.
- [ ] `[M]` `GET` of a deleted id returns 404.
- [ ] `[S]` Restore with a now-taken unique value returns 409.
- [ ] `[S]` Purge job removes rows past retention and logs counts.
- [ ] `[A]` Deletion request anonymises personal fields and leaves accounting records intact.

## Pitfalls

- **Full unique index with soft delete** → users can't re-register → partial index.
- **Filter remembered per query** → deleted data leaks in one forgotten list → one helper, reviewed.
- **Soft-deleting personal data forever** → legal exposure → anonymise or purge after retention.

## Related

`backend/data/audit-log.md` · `backend/data/migrations.md` · `Stacks/Database.md` §2 §4
