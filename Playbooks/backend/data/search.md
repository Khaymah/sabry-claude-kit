# Search in Postgres

- **Situation:** "search box", search products, customers or orders by name or phone, Arabic search that misses results, autocomplete, "search is slow", "should we add Elasticsearch".
- **Skip when:** the list is under a few hundred rows and a plain filter is enough; or a managed search service is already part of the project.
- **Decision:** Postgres first. Search a stored, normalised copy of the text: trigram index (`pg_trgm`) for names, codes and partial matches; full-text (`simple` config) for long text. Leave Postgres for Meilisearch or Typesense only when measured results or features say so, fed through an outbox.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Tens of thousands of rows: normalised column + trigram index, tenant filter, pagination |
| Standard | Hundreds of thousands: + full-text, ranking, search-as-you-type limits, query tests in Arabic |
| Advanced | Millions of rows, typo tolerance, facets: external engine kept in sync through an outbox |

## Rules

### Minimum — always, never cut

- Search a `SearchText` column holding the normalised value (generated or maintained by the same write path); never `ILIKE` on the raw column and never `lower(col)` without an index on that exact expression.
- Normalise both stored text and the query with one function: strip diacritics and tatweel, `أ إ آ ٱ` → `ا`, `ى` → `ي`, `ة` → `ه`, Arabic-Indic digits `٠-٩` → `0-9`, lowercase Latin, collapse spaces. Keep it as an immutable SQL function plus the identical TS function, with a shared test list.
- `CREATE EXTENSION pg_trgm`; `GIN ("SearchText" gin_trgm_ops)`; for multi-tenant tables use `btree_gin` so the index is `("TenantId", "SearchText")`, or filter by tenant first and accept the plan.
- The tenant filter (and scope filter) is part of every search query (`backend/data/multi-tenancy.md`); never search first and filter in JS.
- Escape `%`, `_` and `\` in user input before building an `ILIKE` pattern; the query is a bound parameter.
- Minimum query length 3 characters for trigram contains (a 2-character `ILIKE '%ab%'` cannot use the index); shorter input is rejected (`400`/empty) or served only by prefix lookup on the code and phone columns, never a full scan; cap length at 100.
- Results are always paginated with a stable order (`backend/api/pagination.md`); no unbounded `LIMIT`.
- Phones and codes are searched on a separate normalised digits-only column (`01012345678`, `+20 10…` both match) with a btree prefix index.

### Standard — adds

- Full-text: `to_tsvector('simple', "SearchText")` stored as a `tsvector` column with a GIN index; `simple` config because Postgres ships no Arabic stemmer; match with `websearch_to_tsquery('simple', $q)` and prefix terms (`:*`) for the last word.
- Ranking: exact code or phone match first, then prefix, then trigram `similarity`, then `ts_rank`; one `ORDER BY` expression with `Id` as the final tiebreak.
- Search-as-you-type: client debounce 250 ms, server limit 10 rows, cancel superseded requests; autocomplete endpoints are rate limited (`backend/reliability/rate-limit.md`).
- Results go through the same permission and scope helpers as lists; search never returns a row the list would hide (`backend/auth/scoped-access.md`).
- Soft-deleted and archived rows are excluded in the query (`backend/data/soft-delete.md`).
- A test list of real Arabic queries (hamza forms, ya/alef maqsura, ta marbuta, diacritics, Arabic digits, mixed Arabic and English) runs against seeded data.

### Advanced — adds

- Meilisearch or Typesense when you need typo tolerance, facets or instant results at scale. Index documents carry `TenantId`; every query adds the tenant filter, and per-tenant search keys are issued by the backend, never the master key.
- Sync through an outbox: the write and an `Outbox` row commit together; a worker reads rows in order and upserts or deletes in the engine, retrying with backoff (`backend/reliability/background-jobs.md`). Deletes and tenant removal are outbox events too.
- A full reindex job from Postgres, run in batches with a new index and an alias swap; used after normalisation changes.
- Postgres stays the source of truth; search results return ids and the app loads rows (with permission checks) from Postgres.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Query `احمد`, stored `أحمد` | Both normalise to `احمد`; match |
| Query `فاطمه`, stored `فاطمة`; `مصطفى` vs `مصطفي` | Match both; ta marbuta and alef maqsura folded on both sides |
| Query with diacritics or tatweel (`مُحَمَّد`, `محـمد`) | Stripped before matching |
| Query typed with Arabic digits `٠١٠١٢٣` | Converted to Latin digits before the phone search |
| Query `%` or `_` | Escaped; matches those characters literally, not everything |
| One-character query | Rejected with an empty result and a hint, no table scan |
| Normalisation function changed | Column regenerated and indexes rebuilt by a migration (`backend/data/migrations.md`); external index fully reindexed |
| Row edited then searched immediately | Postgres: visible at once; external engine: lag is documented and the list reads from Postgres |
| Tenant removed or user loses access | Outbox delete events purge the engine; search results are rechecked against Postgres permissions |
| 100×: 5 million rows | GIN trigram contains on short terms degrades; require 3+ characters, cap results, move to Advanced if p95 > 300 ms on the measured query |
| Twice / parallel: update and delete of one row reach the engine out of order | Outbox is processed in order per row id with a version; a stale event is skipped |

## Example — Standard, Bun + Hono + Drizzle

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE OR REPLACE FUNCTION "NormalizeArabic"(T text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT btrim(regexp_replace(lower(translate(
    regexp_replace(T, '[ً-ْـ]', '', 'g'),
    'أإآٱىة٠١٢٣٤٥٦٧٨٩', 'اااايه0123456789')), '\s+', ' ', 'g'))
$$;
ALTER TABLE "Customers" ADD COLUMN "SearchText" text
  GENERATED ALWAYS AS ("NormalizeArabic"("Name" || ' ' || coalesce("Phone", ''))) STORED;
CREATE INDEX "IdxCustomersSearch" ON "Customers" USING gin ("SearchText" gin_trgm_ops);
```

```ts
export const NormalizeArabic = (Text: string) =>
  Text.replace(/[ً-ْـ]/g, "")
    .replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
    .replace(/[٠-٩]/g, (D) => String("٠١٢٣٤٥٦٧٨٩".indexOf(D)))
    .toLowerCase().replace(/\s+/g, " ").trim()

const EscapeLike = (S: string) => S.replace(/[\\%_]/g, "\\$&")

export async function SearchCustomers(TenantId: string, Raw: string, Limit = 20, Offset = 0) {
  const Q = NormalizeArabic(Raw).slice(0, 100)
  if (Q.length < 3) return []
  return db.select({ Id: Customers.Id, Name: Customers.Name })
    .from(Customers)
    .where(and(eq(Customers.TenantId, TenantId), isNull(Customers.DeletedAt), sql`${Customers.SearchText} ILIKE ${"%" + EscapeLike(Q) + "%"}`))
    .orderBy(sql`similarity(${Customers.SearchText}, ${Q}) DESC`, Customers.Id)
    .limit(Math.min(Limit, 50)).offset(Offset)
}
```

The SQL goes in a migration; the SQL function and the TS function share a test table of inputs and outputs, so they cannot drift. Folding `ة` to `ه` trades a few false matches for finding what users type.

Other stacks: Prisma with `$queryRaw` for the trigram query; Laravel `whereRaw('"SearchText" ILIKE ?', …)`.

## Verify

- [ ] `[M]` `EXPLAIN` on a 100k-row table shows the GIN index used, not a sequential scan.
- [ ] `[M]` The shared test list returns the same normalised output in SQL and TS.
- [ ] `[M]` Another tenant's matching row never appears; `%` input does not return every row.
- [ ] `[S]` Exact phone and code matches rank above fuzzy name matches.
- [ ] `[A]` Deleting a row in Postgres removes it from the engine within the documented lag; reindex rebuilds an identical count.

## Pitfalls

- **`ILIKE '%x%'` on the raw column** → sequential scan, Arabic misses → normalised column with trigram index.
- **Normalising only the query** → stored hamza forms never match → normalise both with the same function.
- **Search results then filtered by tenant or permission in JS** → leaks and wrong page sizes → filter in SQL.
- **Dual writes to the engine from the handler** → drift on failure → outbox.

## Related

`backend/data/multi-tenancy.md` · `backend/auth/scoped-access.md` · `backend/api/pagination.md` · `backend/reliability/background-jobs.md` · `backend/data/migrations.md` · `backend/data/soft-delete.md`
