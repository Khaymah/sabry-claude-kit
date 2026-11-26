# Pagination

- **Situation:** list endpoints, infinite scroll, "load more", admin tables with page numbers, exports of lists, feeds that grow.
- **Skip when:** the list is bounded by design and small (a user's 5 addresses): return it whole with a hard cap.
- **Decision:** keyset (cursor) pagination for every list that grows; an opaque cursor encodes the sort key and the id; page size capped server-side. Offset with page numbers only for small admin tables where jumping to page N matters.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Capped `Limit` on every list; offset acceptable for small tables |
| Standard | Keyset cursors for growing lists, stable sorts, indexes per sort |
| Advanced | Very large tables: estimated totals, search-backed lists, snapshot consistency |

## Rules

### Minimum — always, never cut

- Every list has `Limit` with a default (20) and a maximum (100) enforced by the schema.
- Sort order is always total: the last sort column is `Id`, so ties never shuffle rows between pages.
- No endpoint returns an unbounded list.

### Standard — adds

- Cursor = base64url of `{ Sort, Values: [lastSortValue, lastId] }`; the server validates it (schema, same `Sort` as the request) and rejects tampered ones with `400`.
- Query: `WHERE (SortCol, Id) < ($1, $2) ORDER BY SortCol DESC, Id DESC LIMIT Limit + 1`; the extra row tells `HasMore` without a count.
- Response `Meta: { Limit, NextCursor, HasMore }`; no `Total` on growing lists.
- Each allowed sort has a matching composite index (`(TenantId, SortCol DESC, Id DESC)` with the tenant first in multi-tenant apps).
- Offset pagination (admin): `Page` and `Limit` with `Total` from `COUNT(*)` only while the table is small; switch when it isn't.

### Advanced — adds

- Totals as estimates (`pg_class.reltuples` or a cached counter) when users need a sense of size.
- Full-text or faceted lists served from a search index (Postgres FTS, Meilisearch), paginated by the engine.
- Backwards cursors (`PrevCursor`) when the UI needs both directions.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Rows inserted while a user scrolls | Keyset: no duplicates or skips; new rows appear on refresh |
| Sorting by a nullable column | `NULLS LAST` and the null case handled in the cursor comparison, or the column made `NOT NULL` with a default |
| Sort changed between requests with an old cursor | `400 INVALID_CURSOR`; the client restarts from the first page |
| Cursor from another user or tenant | Harmless: the query is still scoped by owner or tenant |
| Deep offset (`Page=5000`) on admin table | Capped (e.g. 100 pages) with a message to filter instead |
| 100×: 50M rows | Keyset stays O(log n) per page with the index; offset would scan |
| Twice / parallel: two clients page the same list | Cursors are stateless, nothing shared on the server |

## Example — Standard, Drizzle

```ts
const CursorSchema = z.object({ Sort: z.string(), Values: z.tuple([z.string(), z.string().uuid()]) })
const Encode = (C: z.infer<typeof CursorSchema>) => Buffer.from(JSON.stringify(C)).toString("base64url")
const SafeJson = (Text: string): unknown => {
  try {
    return JSON.parse(Text)
  } catch {
    return null
  }
}
function Decode(Raw: string, Sort: string) {
  const Parsed = CursorSchema.safeParse(SafeJson(Buffer.from(Raw, "base64url").toString()))
  if (!Parsed.success || Parsed.data.Sort !== Sort) throw new AppError("INVALID_CURSOR", 400)
  return Parsed.data.Values
}

export async function ListOrders(Q: z.infer<typeof ListOrdersQuery>, CustomerId: string) {
  const After = Q.Cursor ? Decode(Q.Cursor, "-CreatedAt") : null
  const Rows = await db.select({ Id: Orders.Id, Status: Orders.Status, TotalMinor: Orders.TotalMinor, CreatedAt: Orders.CreatedAt })
    .from(Orders)
    .where(and(eq(Orders.CustomerId, CustomerId), NotDeleted(Orders),
      After ? sql`(${Orders.CreatedAt}, ${Orders.Id}) < (${After[0]}::timestamptz, ${After[1]}::uuid)` : undefined))
    .orderBy(desc(Orders.CreatedAt), desc(Orders.Id))
    .limit(Q.Limit + 1)
  const HasMore = Rows.length > Q.Limit
  const Page = HasMore ? Rows.slice(0, Q.Limit) : Rows
  const Last = Page[Page.length - 1]
  return {
    Data: Page,
    Meta: { Limit: Q.Limit, HasMore, NextCursor: HasMore && Last ? Encode({ Sort: "-CreatedAt", Values: [Last.CreatedAt.toISOString(), Last.Id] }) : null },
  }
}
```

A malformed or tampered cursor parses to `null`, fails the schema and becomes `INVALID_CURSOR`. Index: `CREATE INDEX ON "Orders" ("CustomerId", "CreatedAt" DESC, "Id" DESC) WHERE "IsDeleted" = false`.

## Verify

- [ ] `[M]` `Limit=1000` is rejected or capped at 100.
- [ ] `[S]` Paging through 250 rows with 20 inserted mid-way: no duplicates, no gaps among the original rows.
- [ ] `[S]` A tampered cursor returns 400.
- [ ] `[S]` `EXPLAIN` of page 50 shows an index scan, no sort node.
- [ ] `[A]` Totals on large lists come from an estimate or counter.

## Pitfalls

- **`OFFSET` on growing feeds** → slow deep pages, duplicates on insert → keyset.
- **Sorting by `CreatedAt` alone** → ties split across pages → add `Id`.
- **`COUNT(*)` on every page** → the slowest query of the endpoint → `HasMore` via `Limit + 1`.

## Related

`backend/api/rest-design.md` · `quality/performance/query-performance.md` · `Stacks/Database.md` §4
