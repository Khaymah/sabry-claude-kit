# Query performance

- **Situation:** list endpoints, dashboards, reports, GraphQL resolvers, anything that loads related rows; "the page got slow as data grew"; adding an index.
- **Skip when:** never for code that reads a database.
- **Decision:** the number of queries per request is constant (does not grow with the rows returned), each query reads only the columns and rows it shows, and every hot query is backed by an index proven with `EXPLAIN`. A test asserts the query count of every list endpoint.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Every project (this is the performance floor) |
| Standard | Production; tables expected past ~10k rows |
| Advanced | Tables past millions of rows, reporting on live data |

## Rules

### Minimum — always, never cut

- **No query inside a loop**, `map`, `forEach` or resolver per item. Load related rows with one join, one relational query (`with:`), or one `WHERE "Id" IN (…)` and group in memory with a `Map`.
- Lists are paginated with a server-side cap (`Limit ≤ 100`); no endpoint returns a whole table.
- Select the columns the response needs; never `SELECT *` for lists.
- Filter and sort in SQL, never by loading rows and calling `.filter()` / `.sort()` in JS.
- Existence checks use `SELECT 1 … LIMIT 1` or `exists()`, not `COUNT(*)` or loading the row.

### Standard — adds

- Every list endpoint has a test asserting its query count stays the same for 1 row and 50 rows.
- Keyset pagination for lists that grow (feeds, orders, logs); offset only for small admin tables.
- Each foreign key used in a join or filter is indexed; composite indexes put equality columns first, then the sort column.
- Slow-query visibility: `pg_stat_statements` enabled; `log_min_duration_statement = 500ms`.
- Totals on big lists: an estimate, a cached counter, or "has more" instead of exact `COUNT(*)` on every page.
- GraphQL: a DataLoader per request for every relation resolver.

### Advanced — adds

- Every new query on a large table ships with its `EXPLAIN (ANALYZE, BUFFERS)` output in the PR on realistic data volume.
- Reports and dashboards read from a replica or a materialized view refreshed by a job, never from the hot tables on each page view.
- Covering indexes (`INCLUDE`) for the top read paths; partial indexes for the common filter (`WHERE "IsDeleted" = false`).

## Edge cases

| Case | Expected behaviour |
|---|---|
| `IN (…)` with 10,000 ids | Chunked (e.g. 1,000 per query) or replaced by a join on a temp table / `= ANY($1::uuid[])` |
| Relation that returns many children per parent (orders → 500 lines) | Children paginated or counted, not embedded in a list response |
| Sorting by a column with no index on a big table | Add the index or restrict the sort options the API accepts |
| Search with `ILIKE '%term%'` | `pg_trgm` GIN index, or full-text search; never a sequential scan per keystroke |
| ORM lazy relations (TypeORM, Prisma includes in loops, Eloquent) | Eager loading declared on the query (`with`, `include`, `with()` in Laravel) |
| Data at 100× today's size | The query plan still uses an index (check with `EXPLAIN` on a generated dataset) |
| 100×: The same list requested 1,000 times a second | The first page is cached or served from a replica; the query count per request stays constant |
| Twice / parallel: Two requests page through a list while rows are inserted | Keyset pagination keeps pages stable; offset would skip or repeat rows |

## Example — Standard, Drizzle

```ts
export async function ListOrdersWithCustomers(Cursor: TCursor | null, Limit: number) {
  const Page = await db.select({ Id: Orders.Id, CustomerId: Orders.CustomerId, TotalMinor: Orders.TotalMinor, CreatedAt: Orders.CreatedAt })
    .from(Orders)
    .where(and(NotDeleted(Orders), Cursor ? lt(sql`(${Orders.CreatedAt}, ${Orders.Id})`, sql`(${Cursor.CreatedAt}, ${Cursor.Id})`) : undefined))
    .orderBy(desc(Orders.CreatedAt), desc(Orders.Id))
    .limit(Math.min(Limit, 100))

  const CustomerIds = [...new Set(Page.map((O) => O.CustomerId))]
  const Customers = CustomerIds.length
    ? await db.select({ Id: Users.Id, Name: Users.Name }).from(Users).where(inArray(Users.Id, CustomerIds))
    : []
  const ById = new Map(Customers.map((C) => [C.Id, C]))
  return Page.map((O) => ({ ...O, Customer: ById.get(O.CustomerId) ?? null }))
}
```

Two queries for any page size. The N+1 version (`for (const O of Page) await GetUser(O.CustomerId)`) is 1 + page size.

```ts
test("orders list runs a constant number of queries", async () => {
  await SeedOrders(1)
  const One = await CountQueries(() => ListOrdersWithCustomers(null, 50))
  await SeedOrders(49)
  const Fifty = await CountQueries(() => ListOrdersWithCustomers(null, 50))
  expect(Fifty).toBe(One)
})
```

`CountQueries` wraps the call and reads a counter incremented by the Drizzle `logger.logQuery` hook installed in the test database client.

Other stacks: Prisma `include` / `relationLoadStrategy: "join"`; Laravel `with()` plus `Model::preventLazyLoading()` in non-production; Rails `includes` plus `strict_loading`; GraphQL `dataloader`.

## Verify

- [ ] `[M]` No `await` on a query inside `for`, `map`, `forEach` or a per-item resolver (`no-await-in-loop` lint + review).
- [ ] `[M]` Every list endpoint has a capped limit.
- [ ] `[S]` Query-count test passes for every list endpoint (1 row vs 50 rows).
- [ ] `[S]` `pg_stat_statements` top 10 by total time reviewed after launch.
- [ ] `[A]` `EXPLAIN (ANALYZE, BUFFERS)` attached for new queries on large tables, no `Seq Scan` on them.

## Pitfalls

- **`Promise.all(Items.map((I) => db.query…))`** → still N queries, now also N connections at once → one `IN` query.
- **Loading rows then `.filter()` in JS** → transfers and allocates the whole table → `WHERE` in SQL.
- **Index on every column** → slow writes, unused indexes → index the queries you run; drop indexes with `idx_scan = 0`.

## Related

`quality/performance/round-trips.md` · `quality/performance/memory.md` · `Stacks/Database.md` §3 §4 · `quality/TRAPS.md`
