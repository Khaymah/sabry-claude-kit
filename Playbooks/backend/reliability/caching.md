# Caching

- **Situation:** a slow or frequently read endpoint, reference data, expensive aggregates (dashboards), third-party responses (exchange rates, maps), Redis, HTTP cache headers, CDN, "the data is stale".
- **Skip when:** nothing has been measured as slow or expensive. A cache adds invalidation bugs; add one for a reason you can name.
- **Decision:** cache the result closest to its consumer that stays correct: HTTP caching for public content, an in-process LRU for small hot reference data, Redis for shared or large entries. Every cache has a TTL **and** an invalidation path on writes; keys include tenant and a schema version; per-user data never enters a shared HTTP cache.

## Levels

| Level | Pick when |
|---|---|
| Minimum | No app cache; correct `Cache-Control` headers |
| Standard | Measured hot paths: LRU or Redis with event invalidation |
| Advanced | High traffic: Nginx micro-caching, stale-while-revalidate, stampede protection |

## Rules

### Minimum — always, never cut

- API responses with user data: `Cache-Control: private, no-store` (or `no-cache` with ETag). Public content: `public, max-age=…`.
- Static assets with hashed filenames: `Cache-Control: public, max-age=31536000, immutable`.
- `SystemSettings` already live in memory (`Stacks/Database.md` §1); don't add another cache for them.

### Standard — adds

- Cache what was measured: name the endpoint, its p95 before, and the target.
- In-process: `lru-cache` with `max` and `ttl` (`quality/performance/memory.md`), for data identical for everyone (categories, plans, countries).
- Redis for data shared across instances or too big for each process; values JSON with a version prefix in the key: `v3:t:<TenantId>:product:<Id>`.
- Invalidation on write: the service that changes the data deletes the keys in the same code path, after commit (an event listener on `Products.Updated`). TTL is the safety net, not the plan.
- Cache-aside: read cache → miss → load → set with TTL. Never cache errors or empty results from a failing dependency.
- Third-party responses (exchange rates, geocoding) cached by their natural validity, with the fetch time stored and shown when it matters.

### Advanced — adds

- Stampede protection: a single in-flight load per key (request coalescing) and jittered TTLs.
- Stale-while-revalidate: serve the stale value while one request refreshes it.
- Nginx `proxy_cache` micro-caching (1–5 s) for public, anonymous GET endpoints under heavy read load.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Product updated in admin, old price still shown | Update handler deletes `product:<Id>` and list keys it affects after commit; test proves the next read is fresh |
| Two instances with in-process caches | Invalidation sent over Postgres `NOTIFY` or Redis pub/sub to every instance, or use Redis only |
| Cached value's schema changes in a deploy | Key version bumped (`v3` → `v4`), old keys expire |
| Permission-dependent data | Never cached across users; cache per user only if measured necessary, with short TTL |
| Redis unavailable | Reads fall through to the database (with timeouts), writes skip the cache; alert |
| 100×: 100× reads on one hot key | In-process LRU in front of Redis for that key; coalescing on miss |
| Twice / parallel: write and read race (read loads old value after delete) | Delete again after a short delay, or version the value with `UpdatedAt` and refuse to set an older one |

## Example — Standard, Bun + Redis

```ts
const KEY_VERSION = "v1"
const ProductKey = (TenantId: string, Id: string) => `${KEY_VERSION}:t:${TenantId}:product:${Id}`

export async function GetProductCached(TenantId: string, Id: string) {
  const Key = ProductKey(TenantId, Id)
  const Hit = await Redis.get(Key)
  if (Hit) return JSON.parse(Hit) as IProductView
  const Product = await LoadProductView(TenantId, Id)
  if (Product) await Redis.set(Key, JSON.stringify(Product), "EX", 300 + Math.floor(Math.random() * 60))
  return Product
}

EventBus.On("Products.Updated", async ({ TenantId, ProductId }) => {
  await Redis.del(ProductKey(TenantId, ProductId))
})
```

`IProductView` holds amounts as strings, so `JSON.stringify` never meets a `bigint`. The listener runs after the transaction commits (events are emitted post-commit), so a reader can't re-cache the old row.

## Verify

- [ ] `[M]` A user-data endpoint returns `Cache-Control: private`.
- [ ] `[S]` Every cache has a named reason and a measured before/after in the PR.
- [ ] `[S]` Updating a product shows the new value on the next read (test).
- [ ] `[S]` With Redis stopped, the endpoint still answers from the database.
- [ ] `[A]` 100 parallel misses on one key cause one database load.

## Pitfalls

- **Caching without invalidation** → users see wrong prices for the TTL → delete on write.
- **Per-user data with `public` headers** → a CDN serves one user's data to another → `private`.
- **Caching before measuring** → complexity with no gain → measure first.

## Related

`quality/performance/round-trips.md` · `quality/performance/memory.md` · `backend/data/multi-tenancy.md` · `Stacks/Database.md` §1
