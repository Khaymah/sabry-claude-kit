# Memory

- **Situation:** exports, imports, reports, file uploads and downloads, in-memory caches, long-running processes whose memory grows, PM2 restarts for memory, "out of memory" crashes.
- **Skip when:** short scripts on small, bounded data.
- **Decision:** memory per request is bounded by a limit we set, not by the data size: large data is streamed or processed in batches, every in-process cache has a maximum size, and nothing global grows without an eviction rule.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Every server |
| Standard | Production; any export, import or upload |
| Advanced | Long-lived processes under load, many instances on small servers |

## Rules

### Minimum — always, never cut

- Request body size limited at Nginx (`client_max_body_size`) and in the app (`bodyLimit`), per route: small for JSON, larger only on upload routes.
- No endpoint or job loads a whole table into memory. Large reads go in keyset batches (`WHERE "Id" > $last ORDER BY "Id" LIMIT 1000`).
- No module-level `Map`, array or object that grows per request or per user without eviction.

### Standard — adds

- Exports stream: rows read in batches and written to the response (`c.stream`) or to a file, never built as one big string or array.
- Uploads stream to disk or object storage; never `await c.req.arrayBuffer()` on a large file.
- In-process caches use `lru-cache` with `max` (entries) and `ttl`; Redis for anything shared or large.
- Timers, intervals and event listeners created per request or per connection are removed when it ends (`clearInterval`, `off`, `AbortController`).
- PM2 `max_memory_restart` (or systemd `MemoryMax`) set as a safety net, with an alert when it triggers: a restart is a symptom to investigate, not a fix.

### Advanced — adds

- Heap snapshots compared before and after load (`Bun.generateHeapSnapshot()` / Node `--heapsnapshot-signal`) when memory grows steadily.
- Memory per process tracked as a metric; capacity planned as instances × peak RSS < server RAM − database − OS.
- Large JSON responses replaced by pagination or NDJSON streaming.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Export of 1M rows to CSV or Excel | Streamed CSV; Excel through a streaming writer (`exceljs` `stream.xlsx.WorkbookWriter`) in a background job, link emailed when ready |
| Upload of a 2 GB file | Rejected by the body limit unless the route is a streaming or presigned upload directly to storage |
| Image resizing | `sharp` streams; one job at a time per CPU, not per request |
| Cache keyed by user input (search terms) | LRU with a max, otherwise an attacker fills memory |
| Closure captures a large object in a long-lived callback | Capture only the ids needed |
| Process memory grows slowly over days | Heap snapshot diff; common causes: listeners not removed, unbounded maps, retained request objects in a global |

## Example — Standard, Bun + Hono

```ts
import { bodyLimit } from "hono/body-limit"
import { stream } from "hono/streaming"
import { LRUCache } from "lru-cache"

App.use("/api/*", bodyLimit({ maxSize: 1024 * 1024, onError: (c) => c.json(ErrorBody("PAYLOAD_TOO_LARGE"), 413) }))

ReportsRoutes.get("/orders.csv", Auth, async (c) => {
  c.header("Content-Type", "text/csv; charset=utf-8")
  c.header("Content-Disposition", 'attachment; filename="orders.csv"')
  return stream(c, async (S) => {
    await S.write("﻿Id,CreatedAt,TotalMinor,Currency\n")
    let LastId: string | null = null
    while (true) {
      const Batch = await db.select({ Id: Orders.Id, CreatedAt: Orders.CreatedAt, TotalMinor: Orders.TotalMinor, Currency: Orders.Currency })
        .from(Orders)
        .where(and(NotDeleted(Orders), LastId ? gt(Orders.Id, LastId) : undefined))
        .orderBy(Orders.Id)
        .limit(1_000)
      if (Batch.length === 0) break
      await S.write(Batch.map((R) => `${R.Id},${R.CreatedAt.toISOString()},${R.TotalMinor},${R.Currency}`).join("\n") + "\n")
      LastId = Batch[Batch.length - 1].Id
    }
  })
})

export const ProductCache = new LRUCache<string, IProduct>({ max: 5_000, ttl: 60_000 })
```

UUIDv7 ids are time-ordered, so `ORDER BY "Id"` is a stable keyset. The `﻿` BOM makes Excel open Arabic text correctly.

Nginx: `client_max_body_size 1m;` globally, raised only in the `location` of upload routes.

## Verify

- [ ] `[M]` A 20 MB JSON body to a normal route returns 413.
- [ ] `[M]` `grep -rn "^const .* = new Map\|^export const .* = new Map" Src/` → each has an eviction rule or a fixed key set.
- [ ] `[S]` Exporting 500k rows keeps the process RSS within ~100 MB of its idle value (watch `pm2 monit` or `ps`).
- [ ] `[S]` Every in-process cache has `max` and `ttl`.
- [ ] `[A]` One hour of load test: memory flat after warm-up.

## Pitfalls

- **`const Rows = await db.select().from(Orders)` for an export** → OOM at scale → keyset batches + stream.
- **Global `Map` as a cache** → grows forever → LRU with max.
- **Raising `max_old_space_size` to fix a leak** → crashes later and bigger → find the leak.

## Related

`quality/performance/round-trips.md` · `backend/files/uploads.md` · `backend/files/import-export.md` · `quality/TRAPS.md`
