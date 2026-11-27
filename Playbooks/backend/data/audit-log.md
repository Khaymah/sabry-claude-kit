# Audit log

- **Situation:** "who changed this?", history of an order or a price, admin actions, permission changes, financial edits, compliance requests, a client dispute.
- **Skip when:** a prototype; the application log is enough until real users and money arrive.
- **Decision:** an append-only `AuditLogs` table written in the same transaction as the change it records: who, what action, which entity, before and after (changed fields only), when, request id. The app can insert but never update or delete it.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Not required |
| Standard | Production: sensitive actions audited (money, permissions, settings, deletions, admin actions) |
| Advanced | Regulated data or enterprise clients: every write audited, tamper evidence, retention policy |

## Rules

### Minimum

- Nothing beyond the application log.

### Standard — adds

- Table (`Id` type follows the project: uuid, bigint or ulid): `Id`, `TenantId` (if multi-tenant), `ActorId` (nullable for system), `ActorType` (`User`, `Admin`, `System`, `ApiKey`), `Action` (`Order.Refunded`), `EntityType`, `EntityId`, `Changes jsonb` (`{ Field: [Before, After] }`), `RequestId`, `Ip`, `CreatedAt`.
- Written by the service in the same transaction as the change, through one `WriteAudit(Tx, …)` helper.
- Audited actions at least: sign-in from a new device, password and email changes, role and permission changes, `SystemSettings` changes (key only for secrets), refunds and manual balance changes, deletions and restores, data exports, impersonation.
- Secrets, passwords, tokens and full card data never appear in `Changes`; secret settings record `"[changed]"`.
- The app database role has `INSERT` and `SELECT` on `AuditLogs`, no `UPDATE` or `DELETE`.
- Index `(EntityType, EntityId, CreatedAt DESC)` for the record's history view, `(ActorId, CreatedAt DESC)` for "what did this admin do".

### Advanced — adds

- Every write on regulated entities audited, from a generic helper or database triggers.
- Tamper evidence: each row stores a hash of its content plus the previous row's hash per tenant; a nightly job verifies the chain.
- Monthly partitions; retention from `SystemSettings` (e.g. 2–7 years); old partitions archived, not deleted early.
- Audit export per tenant or per user on request.

## Edge cases

| Case | Expected behaviour |
|---|---|
| The change fails and rolls back | The audit row rolls back with it: no audit of things that didn't happen |
| System job changes data (expiry, purge) | `ActorType = System`, `ActorId` null, the job name in `Action` metadata |
| Admin impersonates a user | Both ids recorded: `ActorId` = admin, `OnBehalfOf` = user |
| Bulk operation on 10,000 rows | One audit row with the filter and count, not 10,000 rows, unless the regulation requires per-row |
| Personal data inside `Changes` after a deletion request | Anonymised by the same purge that anonymises the record (the audit keeps that a change happened) |
| 100×: hundreds of millions of rows | Monthly partitions; queries always bounded by entity or actor and time |
| Twice / parallel: two edits at the same moment | Two rows, each with its own before/after; the `Version` rule (`backend/data/concurrency.md`) prevents silent overwrite |

## Example — Standard, Drizzle

The sample uses a `uuidv7` id, the default for new tables with no convention; keep the project's id type.

```ts
export const AuditLogs = pgTable("AuditLogs", {
  Id: uuid("Id").primaryKey().$defaultFn(() => uuidv7()),
  ActorId: uuid("ActorId"),
  ActorType: text("ActorType").notNull(),
  Action: text("Action").notNull(),
  EntityType: text("EntityType").notNull(),
  EntityId: uuid("EntityId").notNull(),
  Changes: jsonb("Changes"),
  RequestId: text("RequestId"),
  Ip: text("Ip"),
  CreatedAt: timestamp("CreatedAt", { withTimezone: true }).notNull().defaultNow(),
}, (T) => [index().on(T.EntityType, T.EntityId, T.CreatedAt), index().on(T.ActorId, T.CreatedAt)])

const SECRET_FIELDS = new Set(["PasswordHash", "SecretValue", "Token", "TokenHash"])

export function Diff<T extends Record<string, unknown>>(Before: T, After: Partial<T>) {
  const Out: Record<string, [unknown, unknown]> = {}
  for (const Key of Object.keys(After)) {
    if (Before[Key] === After[Key]) continue
    Out[Key] = SECRET_FIELDS.has(Key) ? ["[hidden]", "[changed]"] : [Before[Key], After[Key]]
  }
  return Out
}

export const WriteAudit = (Tx: TTx, Entry: Omit<typeof AuditLogs.$inferInsert, "RequestId" | "Ip" | "ActorType"> & { ActorType?: string }) =>
  Tx.insert(AuditLogs).values({ ActorType: "User", ...Entry, RequestId: CurrentRequestId(), Ip: CurrentIp() })
```

```sql
REVOKE UPDATE, DELETE ON "AuditLogs" FROM app_user;
```

`Diff` compares primitives; for `Date` and `bigint` fields, normalise to strings first so the JSON is stable.

## Verify

- [ ] `[S]` Refund, role change and setting change each produce one audit row with actor, request id and changed fields.
- [ ] `[S]` A failed change leaves no audit row.
- [ ] `[S]` `UPDATE "AuditLogs"` as the app role fails with a permission error.
- [ ] `[S]` No password, token or secret value appears in `Changes` (`grep` on a test dump).
- [ ] `[A]` The hash-chain verification job passes; altering one row makes it fail.

## Pitfalls

- **Audit written after the transaction** → records changes that rolled back, or misses ones that committed → same transaction.
- **Whole rows in `Changes`** → huge table and personal data copies → changed fields only.
- **Audit in the application log** → rotated away, not queryable per record → table.

## Related

`backend/data/soft-delete.md` · `backend/auth/rbac.md` · `quality/observability/logging.md`
