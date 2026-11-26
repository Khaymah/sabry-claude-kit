# Round trips and batching

- **Situation:** reading or writing many items (settings, cache keys, rows, files, external API calls), bulk import, sending many notifications, `Promise.all` over a list, fan-out to providers.
- **Skip when:** exactly one item, always.
- **Decision:** many items cost one round trip, or a fixed number of chunked ones, never one per item; parallel work is bounded by an explicit concurrency limit; related values are read from one consistent snapshot.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Every project |
| Standard | Production; lists or batches over ~100 items |
| Advanced | High throughput, bulk pipelines, many instances |

## Rules

### Minimum — always, never cut

- Many reads by key → one call: SQL `IN` / `= ANY`, Redis `MGET` or a pipeline, the provider's batch endpoint.
- Many inserts → one multi-row `INSERT … VALUES (…), (…)`; many upserts → one `INSERT … ON CONFLICT DO UPDATE`. Never an insert per row in a loop.
- `SystemSettings` and other reference data are loaded **all at once** at boot into memory (one query), then read from memory. A request never reads settings from the database, key by key or otherwise.
- No unbounded `Promise.all` over user-sized lists: it opens N connections or N outbound requests at once.

### Standard — adds

- Chunk big batches: at most ~1,000 rows per statement (Postgres allows 65,535 bind parameters per statement: rows × columns must stay under it).
- Bounded concurrency for independent async work: `p-limit` (or a small pool) sized below the DB pool or the provider's rate limit, typically 5–10.
- Related settings read together from one snapshot (`GetSettings([...])`), so a refresh between two reads can't mix an old provider name with a new key.
- The settings cache reload replaces the whole map in one assignment (load into a new `Map`, then swap), never clear-then-refill.
- Sequential awaits that don't depend on each other run in parallel (`Promise.all` on a fixed small set).
- Notifications to many users: one job that batches (provider bulk API, or chunks of N), not N jobs enqueued in a loop with N inserts.

### Advanced — adds

- `COPY` (`pg-copy-streams`, `postgres.js` `.writable()`) for imports over ~50k rows.
- Request coalescing for hot cache misses (one in-flight load per key; others await it) to avoid a stampede.
- Batched writes for counters and analytics (accumulate in memory or Redis, flush every N seconds).

## Edge cases

| Case | Expected behaviour |
|---|---|
| Batch of 50,000 rows | Chunked; each chunk in its own transaction or one `COPY`; progress logged per chunk |
| One item in the batch fails validation | Validate all first; report the bad rows with their index; insert none or only the valid ones, per the feature's stated rule |
| Provider rate limit (e.g. 10 req/s) | Concurrency and a token bucket below the limit; `429` honoured with `Retry-After` |
| Duplicate keys in the input | Deduplicated before the query (`new Set`), so `ON CONFLICT` doesn't hit the same row twice in one statement (Postgres errors on that) |
| Empty list | No query at all (`IN ()` is invalid SQL in some drivers) |
| Setting changed while a request is running | The request keeps the snapshot it started with |
| 100×: Settings or reference data 100× larger | Still one query at boot; if it no longer fits in memory, it is not reference data and moves to a cached lookup |
| Twice / parallel: The same import runs twice at once | The upsert on the natural key makes the second run a no-op; a Postgres advisory lock per import type when order matters |

## Example — Standard, Bun + Drizzle

```ts
import pLimit from "p-limit"

const CHUNK = 1_000

export async function UpsertProducts(Rows: TProductInput[]) {
  const Unique = [...new Map(Rows.map((R) => [R.Sku, R])).values()]
  for (let I = 0; I < Unique.length; I += CHUNK) {
    // eslint-disable-next-line no-await-in-loop -- one bulk statement per chunk
    await db.insert(Products)
      .values(Unique.slice(I, I + CHUNK))
      .onConflictDoUpdate({ target: Products.Sku, set: { Name: sql`excluded."Name"`, PriceMinor: sql`excluded."PriceMinor"` } })
  }
}

const Limit = pLimit(8)
export const SyncAll = (Ids: string[]) => Promise.all(Ids.map((Id) => Limit(() => SyncOne(Id))))

let Snapshot = new Map<string, unknown>()

export async function ReloadSettings() {
  const Rows = await db.select().from(SystemSettings)
  Snapshot = new Map(Rows.map((R) => [R.Key, ReadValue(R)]))
}

export function GetSettings<const K extends TSettingKey[]>(Keys: K) {
  const Current = Snapshot
  return Keys.map((Key) => Current.get(Key)) as { [I in keyof K]: TSettingValue<K[I]> }
}
```

The `for` loop over chunks is the one accepted `await` in a loop: a fixed number of statements, each one bulk. Mark its `await` with `// eslint-disable-next-line no-await-in-loop -- one bulk statement per chunk` for the kit's ESLint preset.

Other stacks: Prisma `createMany` / `$transaction([...])`; Laravel `upsert()` and `chunk()`; ioredis `pipeline()`.

## Verify

- [ ] `[M]` No `insert(` / `update(` / `get(` call inside a loop over input items.
- [ ] `[M]` Settings are read from memory: zero `SystemSettings` queries per request (query log).
- [ ] `[S]` Importing 10,000 rows runs ≤ 10 insert statements.
- [ ] `[S]` Every `Promise.all` over a dynamic list goes through a concurrency limit.
- [ ] `[S]` Concurrent settings reload during a request does not mix values (test swaps the map mid-request).
- [ ] `[A]` Cache stampede test: 100 parallel misses on one key → one load.

## Pitfalls

- **`for (const R of Rows) await db.insert(…)`** → N round trips, minutes instead of milliseconds → bulk insert.
- **`Promise.all` over 5,000 items** → pool exhausted, provider bans the IP → bounded concurrency.
- **Clear-then-refill cache** → a window where every read misses → build new, swap.

## Related

`quality/performance/query-performance.md` · `quality/performance/memory.md` · `backend/reliability/caching.md` · `Stacks/Database.md` §1 · `quality/TRAPS.md`
