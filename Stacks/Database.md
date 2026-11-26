# Database — every stack

Default: **PostgreSQL 16+**, accessed through the stack's ORM (Drizzle for TypeScript). Read this file before any schema, migration, query or configuration work, whatever the language.

---

## 1. Configuration lives in the database — `SystemSettings`

**Runtime configuration is a table, not environment variables.** The environment holds only what the process needs before it can read that table:

| Stays in the environment | Why |
|---|---|
| `DATABASE_URL` | Needed to reach the table itself |
| `SETTINGS_ENCRYPTION_KEY` | 32 random bytes, base64; decrypts the secrets in the table |
| `APP_ENV` / `NODE_ENV`, `PORT` | Known before the database is reachable |

Everything else goes in `SystemSettings`: SMTP, payment and messaging keys, third-party URLs, feature flags, limits, prices, business rules, texts. They change from the admin panel, with an audit trail, without a deploy.

### Schema

```sql
CREATE TABLE "SystemSettings" (
  "Id"          uuid PRIMARY KEY,
  "Key"         text NOT NULL UNIQUE CHECK ("Key" ~ '^[A-Z][A-Za-z0-9]*(\.[A-Z][A-Za-z0-9]*)+$'),
  "Value"       jsonb,
  "SecretValue" text,
  "IsSecret"    boolean NOT NULL DEFAULT false,
  "KeyVersion"  integer NOT NULL DEFAULT 1,
  "Description" text NOT NULL DEFAULT '',
  "UpdatedBy"   uuid REFERENCES "Users"("Id") ON DELETE SET NULL,
  "CreatedAt"   timestamptz NOT NULL DEFAULT now(),
  "UpdatedAt"   timestamptz NOT NULL DEFAULT now(),
  CHECK (("IsSecret" AND "Value" IS NULL) OR (NOT "IsSecret" AND "SecretValue" IS NULL))
);

CREATE TABLE "SystemSettingsHistory" (
  "Id"        uuid PRIMARY KEY,
  "Key"       text NOT NULL,
  "OldValue"  jsonb,
  "NewValue"  jsonb,
  "ChangedBy" uuid REFERENCES "Users"("Id") ON DELETE SET NULL,
  "ChangedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON "SystemSettingsHistory" ("Key", "ChangedAt" DESC);
```

Keys are namespaced PascalCase: `Smtp.Host`, `Payments.Paymob.ApiKey`, `Orders.MaxItemsPerOrder`. For a secret, the history records that it changed and who changed it, never the value (`OldValue`/`NewValue` stay null).

### Rules

1. **One registry in code** declares every key: its schema (Zod or the stack's validator), default, `IsSecret`, description and the permission that may edit it. A key not in the registry is rejected on read and on write.
2. **Boot:** insert missing keys with their defaults (`INSERT … ON CONFLICT ("Key") DO NOTHING`), validate every value against its schema, and **fail fast** in production when a required secret is empty.
3. **Reads come from memory.** One cache per process: load all settings at boot, refresh on change through Postgres `LISTEN/NOTIFY` (or Redis pub/sub when there is Redis), with a 60-second TTL as a safety net. A request never queries the table.
4. **Secrets:** AES-256-GCM, a random 12-byte IV per value, stored as `base64(iv | authTag | ciphertext)` in `SecretValue`, with `KeyVersion`. Key rotation: add the new key, re-encrypt in a job, bump `KeyVersion`. Losing `SETTINGS_ENCRYPTION_KEY` means re-entering the secrets: keep it in the server's secret store and in the owner's password manager.
5. **Secrets are write-only.** The API never returns them: it returns `IsSet: true` and at most the last four characters. Never log a setting's value; log the key and who changed it.
6. **Writes:** validate with the registry schema, update inside a transaction together with the history row, then `NOTIFY` so every instance reloads. Only users with the key's permission can write it.
7. **Per environment:** each environment has its own database, so its own settings. A copy of production into staging scrubs the secrets.
8. **The browser never reads settings directly.** A frontend gets the public subset through an API endpoint; build-time public variables are only for values that truly cannot wait for the API.
9. **Tests:** encryption round trip, an unknown key rejected, a missing required secret failing boot, a change reaching a second instance through `NOTIFY`.

### Drizzle (TypeScript)

```ts
export const SystemSettings = pgTable("SystemSettings", {
  Id: uuid("Id").primaryKey().$defaultFn(() => uuidv7()),
  Key: text("Key").notNull().unique(),
  Value: jsonb("Value"),
  SecretValue: text("SecretValue"),
  IsSecret: boolean("IsSecret").notNull().default(false),
  KeyVersion: integer("KeyVersion").notNull().default(1),
  Description: text("Description").notNull().default(""),
  UpdatedBy: uuid("UpdatedBy").references(() => Users.Id, { onDelete: "set null" }),
  CreatedAt: timestamp("CreatedAt", { withTimezone: true }).notNull().defaultNow(),
  UpdatedAt: timestamp("UpdatedAt", { withTimezone: true }).notNull().defaultNow(),
})

export const SETTINGS = {
  "Smtp.Host": { Schema: z.string().min(1), Default: "", IsSecret: false, Permission: "Settings.Mail" },
  "Smtp.Password": { Schema: z.string().min(1), Default: "", IsSecret: true, Permission: "Settings.Mail" },
  "Orders.MaxItemsPerOrder": { Schema: z.number().int().min(1).max(500), Default: 50, IsSecret: false, Permission: "Settings.Orders" },
} as const satisfies Record<string, ISettingDefinition>

export function Encrypt(Plain: string, Key: Buffer): string {
  const Iv = randomBytes(12)
  const Cipher = createCipheriv("aes-256-gcm", Key, Iv)
  const Data = Buffer.concat([Cipher.update(Plain, "utf8"), Cipher.final()])
  return Buffer.concat([Iv, Cipher.getAuthTag(), Data]).toString("base64")
}

export function Decrypt(Stored: string, Key: Buffer): string {
  const Raw = Buffer.from(Stored, "base64")
  const Decipher = createDecipheriv("aes-256-gcm", Key, Raw.subarray(0, 12))
  Decipher.setAuthTag(Raw.subarray(12, 28))
  return Buffer.concat([Decipher.update(Raw.subarray(28)), Decipher.final()]).toString("utf8")
}
```

`GetSetting("Orders.MaxItemsPerOrder")` returns the typed value from the cache; `SetSetting(Key, Value, UserId)` validates, encrypts when secret, writes setting and history in one transaction, then `NOTIFY "SystemSettings"`.

---

## 2. Schema

- **Primary keys:** `uuid` with **UUIDv7** (time-ordered, keeps B-tree inserts local). Never random v4 for primary keys.
- **Base columns on every table:** `Id`, `CreatedAt`, `UpdatedAt` (`timestamptz`, `NOT NULL DEFAULT now()`), `IsDeleted boolean NOT NULL DEFAULT false`, `DeletedAt timestamptz` when deletion time matters.
- **Types:** `text` (length limits as `CHECK`), `timestamptz` only (stored UTC), `boolean NOT NULL`. **Money** as integer minor units (`bigint`) with a currency column, or `numeric(19,4)`; never `float` or `real`.
- **Enums:** `text` with a `CHECK (… IN (…))`, or a lookup table when values change at runtime. Postgres `ENUM` types are hard to change; avoid them.
- **`jsonb`** only for data that is truly schemaless (provider payloads, settings values). Anything filtered, joined or reported on is a column.
- **Constraints belong in the database:** `NOT NULL` by default, foreign keys with an explicit `ON DELETE`, `UNIQUE`, `CHECK`. The application validates too; the database is the last line.
- **Soft delete with uniqueness:** a partial unique index, `CREATE UNIQUE INDEX … ("Email") WHERE "IsDeleted" = false`.
- **Translations:** a separate `<Entity>Translations` table (`EntityId`, `Locale`, fields, unique on `(EntityId, Locale)`, `ON DELETE CASCADE`), never `NameAr`/`NameEn` columns. English is the fallback.
- **Multi-tenant:** `TenantId` on every tenant-owned table, first column of its composite indexes, enforced in every query and with Row-Level Security as the second line.

## 3. Indexes

- Every foreign key used in a join or a filter has an index.
- Composite order: equality columns first, then the range or sort column (`("TenantId", "Status", "CreatedAt" DESC)`).
- Partial indexes for the common filter (`WHERE "IsDeleted" = false`); `INCLUDE` columns for hot read paths that can be index-only.
- Prove an index with `EXPLAIN (ANALYZE, BUFFERS)` on realistic data; find slow queries with `pg_stat_statements`; drop indexes whose `idx_scan` stays 0 in `pg_stat_user_indexes`.
- In production: `CREATE INDEX CONCURRENTLY` (outside a transaction).

## 4. Queries

- Parameters only; never string concatenation into SQL.
- **No N+1:** load related rows with a join, `IN (…)` or the ORM's relational query, one round trip per list.
- **Pagination:** keyset for lists that grow (`WHERE ("CreatedAt", "Id") < ($1, $2) ORDER BY "CreatedAt" DESC, "Id" DESC LIMIT $3`); offset only for small admin tables; page size capped server-side.
- Lists select the columns they show, not `*`.
- Every `UPDATE` and `DELETE` has a `WHERE`; the soft-delete filter is applied by one shared helper, not remembered per query.
- No `COUNT(*)` over a large table on a hot path; keep a counter or show "more".

## 5. Transactions and concurrency

- One business operation, one transaction. Keep it short and never call the network inside it.
- **Never read-check-write in application code.** Use one of:
  - an atomic conditional update: `UPDATE "Products" SET "Stock" = "Stock" - $1 WHERE "Id" = $2 AND "Stock" >= $1 RETURNING "Stock"` (no row returned means not enough stock);
  - `SELECT … FOR UPDATE` inside the transaction, locking rows in a consistent order to avoid deadlocks;
  - a unique constraint that makes the second writer fail.
- **Idempotency:** an `IdempotencyKeys` table with a unique key for payments, webhooks and any retried write.
- **Edits by people:** optimistic locking with a `Version` column (`WHERE "Id" = $1 AND "Version" = $2`).
- Isolation: `READ COMMITTED` by default; `SERIALIZABLE` with a retry loop for invariants across many rows.

## 6. Migrations

- Generated SQL, reviewed and committed (`drizzle-kit generate`); never `push` against production.
- **Expand → migrate → contract** for renames, type changes and drops, so the running version keeps working during the deploy.
- Large tables: add a column nullable, backfill in batches, then `SET NOT NULL` (via a `CHECK … NOT VALID` then `VALIDATE`); indexes `CONCURRENTLY`.
- Set `lock_timeout` and `statement_timeout` in migrations so a blocked migration fails instead of freezing the site.
- Every migration has a down migration or a written rollback plan, tried on a copy of real data.
- Setting defaults and reference data are idempotent upserts in migrations; demo data lives in seeds, never in migrations.

## 7. Connections

- One pool per process, closed on shutdown. Size about `2 × cores` per instance, and the total across instances below `max_connections`.
- Many instances or serverless: PgBouncer in transaction mode (no session state; check the driver's prepared-statement setting).
- Server-side `statement_timeout` and `idle_in_transaction_session_timeout`.

## 8. Data safety

- Backups: daily logical dump plus WAL archiving or the provider's point-in-time recovery; a restore is rehearsed every month.
- Least privilege: the application role has no DDL; migrations run with a separate role.
- An audit table for sensitive changes: who, what, before, after, when.
- Personal data: encrypt columns that require it, never log full rows, and honour deletion requests across backups' retention.

## 9. Testing

Integration tests run against a real PostgreSQL (a test database or a container), each test in a transaction rolled back at the end. Setup, the template-database alternative, and when a rolled-back transaction cannot work (services that open their own transaction, concurrency tests): `Playbooks/quality/testability/integration-db.md`. No database mocks for queries, constraints or concurrency; a race is tested with real concurrent requests.

---

## Review checklist

```txt
[ ] Runtime config read from SystemSettings; env holds only DATABASE_URL, SETTINGS_ENCRYPTION_KEY, APP_ENV, PORT
[ ] Secrets encrypted (AES-256-GCM), write-only through the API, never logged
[ ] UUIDv7 keys, timestamptz, money as integer minor units, no float
[ ] Constraints in the database: NOT NULL, FK with ON DELETE, UNIQUE, CHECK
[ ] Partial unique indexes with soft delete; index on every joined FK
[ ] No N+1, keyset pagination for growing lists, capped page size
[ ] No read-check-write: atomic update, FOR UPDATE, or a constraint
[ ] Idempotency keys for payments and webhooks
[ ] Migrations reviewed, expand → migrate → contract, timeouts set, rollback written
[ ] Integration tests against a real PostgreSQL
```
