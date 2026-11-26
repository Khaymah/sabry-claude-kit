# Schema migrations on a live database

- **Situation:** adding, renaming or removing columns or tables, changing types, adding indexes or constraints, backfilling data, any schema change on a database that serves users.
- **Skip when:** a local prototype database you can drop and recreate.
- **Decision:** migrations are generated SQL, reviewed and committed, applied by the deploy before the new code starts. Every change keeps the running version working: **expand → migrate → contract** across separate deploys, with lock and statement timeouts so a blocked migration fails instead of freezing the site.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Generated, reviewed migrations; never `push` against shared databases |
| Standard | Production: expand/contract, timeouts, concurrent indexes, batched backfills |
| Advanced | Large tables (millions of rows), zero-downtime SLA |

## Rules

### Minimum — always, never cut

- `drizzle-kit generate` creates the SQL; a human (or the agent, explicitly) reads it before commit. Never `drizzle-kit push` against staging or production.
- Migrations are forward-only files in git; applied ones are never edited.
- A destructive step (drop column or table, type change that loses data) is its own migration, run only after a backup and after no code reads the old shape.
- Reference data and setting defaults are idempotent upserts in migrations; demo data never.

### Standard — adds

- Expand → migrate → contract for renames, type changes and drops:
  1. **Expand:** add the new column or table (nullable or with a default); deploy code that writes both and reads the old.
  2. **Migrate:** backfill in batches; deploy code that reads the new.
  3. **Contract:** stop writing the old; drop it in a later deploy.
- Each migration starts with `SET lock_timeout = '5s'; SET statement_timeout = '60s';`.
- Indexes on existing tables: `CREATE INDEX CONCURRENTLY` in its own migration, outside a transaction.
- `NOT NULL` on an existing column: add `CHECK (… IS NOT NULL) NOT VALID`, `VALIDATE CONSTRAINT`, then `SET NOT NULL`, then drop the check.
- Backfills of more than ~10k rows run in batches (1,000–5,000 rows per transaction). When the project's migrations are the agreed way to change data (or the owner asks for it), the batched backfill lives in a migration; otherwise in a job or script.
- Legacy data is never assumed clean: before a `UNIQUE` index or a `NOT NULL`, query for duplicates, nulls, blanks and values the new rule rejects, and decide in the migration what happens to each (normalise, null out, keep the oldest and report the rest, or a partial unique index). A unique index that fails halfway through a deploy is the usual outage.
- Migrations run with a role that has DDL rights; the app role has none.
- Each migration has a written rollback (a down file or the exact steps), tried on a copy of real data for risky ones.

### Advanced — adds

- Long backfills are resumable (keyset on `Id`, progress logged) and throttled (sleep between batches) to protect replicas and latency.
- Foreign keys on big tables added `NOT VALID`, then validated.
- A migration linter in CI (`squawk`) blocks locking operations.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Rename a column | Three deploys: add new + dual-write, backfill + read new, drop old. Never `RENAME COLUMN` while old code runs |
| Change `integer` money to `bigint` minor units | New column, backfill with conversion, switch reads, drop old |
| Add an enum value (text + `CHECK`) | Drop and re-add the `CHECK` with the new list in one migration; the code that writes the new value deploys after |
| Migration fails half-way | It ran in a transaction and rolled back (except `CONCURRENTLY` steps, which are separate and idempotent with `IF NOT EXISTS`) |
| `lock_timeout` hit during deploy | The deploy stops, the old version keeps serving; retry off-peak |
| 100×: a table of 50M rows | Every step concurrent or batched; no `ALTER` that rewrites the table (type changes, volatile defaults) |
| Twice / parallel: two instances start and both try to migrate | Migrations run once from the deploy script, not on app boot; the migrator takes an advisory lock |

## Example — Standard, rename `Phone` → `PhoneNumber`

```sql
SET lock_timeout = '5s';
SET statement_timeout = '60s';
ALTER TABLE "Users" ADD COLUMN "PhoneNumber" text;
```

```ts
export async function BackfillPhoneNumbers() {
  let LastId = "00000000-0000-0000-0000-000000000000"
  while (true) {
    const Rows = await db.execute<{ Id: string }>(sql`
      UPDATE "Users" SET "PhoneNumber" = "Phone"
      WHERE "Id" IN (SELECT "Id" FROM "Users" WHERE "Id" > ${LastId} AND "PhoneNumber" IS NULL AND "Phone" IS NOT NULL ORDER BY "Id" LIMIT 2000)
      RETURNING "Id"`)
    if (Rows.length === 0) break
    LastId = Rows[Rows.length - 1].Id
    Logger.info({ LastId, Count: Rows.length }, "backfill phone numbers")
  }
}
```

```sql
ALTER TABLE "Users" DROP COLUMN "Phone";
```

Deploy 1 ships the first migration plus code that writes both columns; deploy 2 runs the backfill job and reads `PhoneNumber`; deploy 3, a release later, ships the drop. `RETURNING` order follows the subquery's `ORDER BY` only in practice, so `LastId` is a progress marker; the `IS NULL` filter is what makes the loop correct and resumable.

## Verify

- [ ] `[M]` The migration SQL is in the diff and was read; no `push` in scripts or CI.
- [ ] `[M]` Destructive steps are separate migrations, after a backup.
- [ ] `[S]` Every migration starts with `lock_timeout` and `statement_timeout`.
- [ ] `[S]` Index creation on existing tables uses `CONCURRENTLY`.
- [ ] `[S]` The deployed code works with both the pre- and post-migration schema (run old code against the new schema in staging).
- [ ] `[A]` `squawk` passes in CI.

## Pitfalls

- **Rename or drop while old code runs** → errors during every deploy → expand/contract.
- **Backfill inside the migration** → long lock, deploy timeout → batched job.
- **Migrations on app boot** with several instances → races and half-applied schemas → run once from the deploy.

## Related

`quality/availability/zero-downtime-deploy.md` · `quality/maintainability/refactoring.md` · `Stacks/Database.md` §6
