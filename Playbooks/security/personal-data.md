# Personal data

- **Situation:** storing national IDs, phone numbers, addresses, health or financial details, "what do we do with user data", delete-my-account and download-my-data requests, privacy policy, who may see customer details, Egypt's data protection law.
- **Skip when:** the app stores no information about identifiable people (an internal tool over public data). Retention schedules and purge jobs: `backend/data/data-retention.md`.
- **Decision:** collect the minimum, know where every personal field lives, encrypt the sensitive ones at the application level, log who reads them, and answer export and deletion requests from one maintained inventory. The legal reading is the owner's: this playbook gives the engineering habits, not legal advice.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Any app with accounts: inventory, minimise, no personal data in logs, access control |
| Standard | National ID, health, financial or children's data, or customers' end users: column encryption, access logging, export and deletion flows |
| Advanced | Regulated clients, cross-border transfer, a data protection officer: field-level keys per tenant, breach runbook, processor register |

## Rules

### Minimum — always, never cut

- Keep a personal-data inventory in the repo (`.agents/data-inventory.md`): each personal field, table and column, why it is collected, who can read it, how long it is kept, which third parties receive it.
- Collect a field only when a feature uses it today. "Might need later" is not a reason; a nullable column nobody reads is removed.
- Personal data never appears in logs, URLs, analytics events, error trackers or test fixtures copied from production (`security/secrets.md` redaction list includes `nationalId`, `phone`, `email`).
- Production data is not copied to development; seed and test data is generated.
- Lists and exports show a masked value (`010****678`, `2**********1234`) unless the user's role needs the full value (`backend/auth/rbac.md`).
- Every personal row is reachable by the person it belongs to, so export and deletion can find it: `UserId` or equivalent on every table in the inventory.

### Standard — adds

- Sensitive columns (national ID, passport, tax number, bank account, medical notes) are encrypted at the application layer with AES-256-GCM, a key from the secret store, and a key id stored beside the value for rotation. Phone and email are encrypted only when the threat model needs it; if you must search them, store a keyed hash (`HMAC-SHA256`) in a separate indexed column.
- Never use the encrypted column in `WHERE`, `ORDER BY` or a unique index; use the keyed-hash column for lookup and uniqueness.
- Access to sensitive fields by staff is logged (who, which person, which field, when, reason) in the audit log (`backend/data/audit-log.md`), and reads of full values require a stated reason in the request.
- Export request: an authenticated, rate-limited job produces a JSON or CSV of the person's data from the inventory, delivered by a time-limited private link (`backend/files/uploads.md`), and logged.
- Deletion request: verified by re-authentication, then handled per `backend/data/data-retention.md`: delete or anonymise personal fields, keep what the law or accounting requires (invoices) with the person's link removed, confirm to the user with the date and what was kept.
- Third-party processors (email, SMS, analytics, payment) are listed in the inventory; a deletion request also reaches them through their API.
- Cookie and tracking consent is recorded with timestamp and policy version before non-essential trackers load.

### Advanced — adds

- Per-tenant data keys (envelope encryption) so a tenant's data can be crypto-erased by destroying its key.
- Breach runbook: detect, contain, rotate, assess scope from access logs, notify the owner within the hours the owner and counsel set.
- Data location is documented; cross-border transfers (a US email provider, a foreign cloud region) are listed with the legal basis the owner's counsel confirms.

## Egypt note — verify with counsel

Egypt's Personal Data Protection Law No. 151 of 2020 regulates collecting, processing and transferring personal data, gives people rights to access, correct and object, and sets extra rules for sensitive data and for transfer abroad, with an executive regulation and a supervisory authority (the Personal Data Protection Center). Treat the article numbers, consent wording, licences and deadlines as unverified here: confirm the current text and regulation with the owner's legal adviser before promising specific periods or legal bases to a client. Engineering defaults above (minimise, encrypt, log access, honour export and deletion) hold either way.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Deletion request for a user with unpaid or recent orders | Personal fields anonymised, order and invoice rows kept without the person's link; the user is told what was kept and why |
| Same national ID entered twice, spaces or Arabic-Indic digits (`٢٩٨...`) | Normalised to ASCII digits and trimmed before hashing and encrypting, so the keyed hash matches and duplicates are caught |
| Key rotated while old rows use the old key | `KeyId` on each value decrypts with its own key; a background job re-encrypts gradually (`backend/reliability/background-jobs.md`) |
| Export includes another person's data (a shared address, a message thread) | Only the requester's own fields; the other person's data is redacted |
| Support agent opens a customer by phone number | Search uses the keyed hash; the view is masked and the full reveal writes an audit row |
| Backup still holds deleted data | Documented retention for backups; restores re-apply the deletion log before the system goes live |
| Child under the age the owner's counsel sets | Sign-up asks for a guardian flow if the product reaches minors; do not collect more than needed |
| Data at 100×: export of a user with millions of events | Streamed to a file in a job, paginated by keyset, delivered by link; never built in memory in the request |
| Twice / parallel: two deletion requests, or deletion while an export runs | Request rows have a unique active request per user and type; the second returns the first's status; export reads a snapshot taken before deletion starts |

## Example — Standard, Bun + Hono + Drizzle

```ts
const DataKeys = new Map(Config.DataKeys.map((K) => [K.Id, Buffer.from(K.Value, "base64")]))

export function EncryptField(Plain: string) {
  const Iv = randomBytes(12)
  const Cipher = createCipheriv("aes-256-gcm", DataKeys.get(Config.CurrentDataKeyId)!, Iv)
  const Body = Buffer.concat([Cipher.update(Plain, "utf8"), Cipher.final()])
  return `${Config.CurrentDataKeyId}.${Iv.toString("base64")}.${Cipher.getAuthTag().toString("base64")}.${Body.toString("base64")}`
}

export function DecryptField(Stored: string) {
  const [KeyId, Iv, Tag, Body] = Stored.split(".")
  const Key = DataKeys.get(KeyId)
  if (!Key) throw new AppError("DATA_KEY_UNKNOWN", 500)
  const Decipher = createDecipheriv("aes-256-gcm", Key, Buffer.from(Iv, "base64"))
  Decipher.setAuthTag(Buffer.from(Tag, "base64"))
  return Buffer.concat([Decipher.update(Buffer.from(Body, "base64")), Decipher.final()]).toString("utf8")
}

export const NormaliseLookup = (Plain: string) =>
  Plain.replace(/[٠-٩]/g, (D) => String(D.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (D) => String(D.charCodeAt(0) - 0x06f0)).replace(/[\s-]/g, "")

export const LookupHash = (Plain: string) => createHmac("sha256", Config.LookupHashKey).update(NormaliseLookup(Plain)).digest("hex")

export const MaskNationalId = (Value: string) => `${Value.slice(0, 1)}${"*".repeat(9)}${Value.slice(-4)}`

export const Customers = pgTable("Customers", {
  ...BaseColumns,
  TenantId: uuid("TenantId").notNull(),
  NationalIdEncrypted: text("NationalIdEncrypted"),
  NationalIdHash: text("NationalIdHash"),
}, (T) => [uniqueIndex("CustomersNationalIdHash").on(T.TenantId, T.NationalIdHash)])

export const DataRequests = pgTable("DataRequests", {
  ...BaseColumns,
  UserId: uuid("UserId").notNull(),
  Type: text("Type").notNull(),
  Status: text("Status").notNull().default("Pending"),
}, (T) => [uniqueIndex("DataRequestsActive").on(T.UserId, T.Type).where(sql`${T.Status} IN ('Pending', 'Running')`)])
```

`LookupHash` normalises Arabic-Indic digits, spaces and dashes first, so `٢٩٩٠١٠١…` and `2990101…` match the same row. Other stacks: Postgres `pgcrypto` encrypts in SQL but exposes keys to the database; prefer app-level keys when the threat is a database leak. Managed KMS envelope encryption fits Advanced.

## Verify

- [ ] `[M]` The inventory lists every table and column holding personal data; a schema diff without an inventory update fails review.
- [ ] `[M]` A request with a national ID and phone produces logs, traces and error reports with neither value.
- [ ] `[M]` A staff list endpoint returns masked values; the full value needs the right role.
- [ ] `[S]` Reading the encrypted column in `psql` shows ciphertext only; decrypting with the wrong key fails.
- [ ] `[S]` Looking up a customer by national ID with Arabic digits finds the same row as ASCII digits.
- [ ] `[S]` A deletion request leaves invoices without the person's name and removes the user from each processor.
- [ ] `[A]` Destroying a tenant key makes that tenant's ciphertext unreadable.

## Pitfalls

- **Encrypting a column then `WHERE NationalId = $1`** → never matches, or a full decrypt scan → keyed-hash column.
- **`hash(nationalId)` with plain SHA-256** → 14-digit IDs are brute-forced in minutes → keyed `HMAC` with a secret key.
- **Same IV reused with AES-GCM** → key recovery risk → a fresh random 12-byte IV per value.
- **Soft delete as "deletion"** → the data is still there → anonymise or purge per `backend/data/data-retention.md`.
- **Production dump on a laptop for debugging** → uncontrolled copy → generated data or a masked snapshot.

## Related

`backend/data/data-retention.md` · `backend/data/audit-log.md` · `backend/auth/rbac.md` · `backend/files/uploads.md` · `security/secrets.md`
