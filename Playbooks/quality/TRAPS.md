# Traps catalog

One line per trap that agents (and people) fall into, with **how to detect it mechanically** and where the fix lives. Paths are relative to `Playbooks/`.

- **Writing code:** scan the sections that match what you touched before calling the work done.
- **Reviewing code** (`code-reviewer`, `team-review`): run the Detect column on the diff; each hit is a finding unless the line carries a reason.
- **Growing it:** when a lesson (`lessons.py`) or a bug reveals a trap that is not here, add one row in the right section. Keep a row only if it can be detected or checked in under a minute.

**Enforced while writing** (`hooks/enforce-code-traps.py`, switch `code_traps`): blocked: `db` / `tx` `update` / `delete` without `.where()` (judged on the file the edit produces) and `.forEach(async`; a deliberate case passes with `// IMPORTANT: allow-where: <reason>` or `allow-foreach-async`. Reported back to the agent: sync crypto, exec or file I/O on request paths, `update` / `delete` without `.where()` on `pool` / `sql` / `knex`, query in a loop or per-item callback, `Promise.all` over a list with DB calls, nested `.find` / `.includes`, `fetch` without `signal`, `z.array` without `.max`, `select()` with no columns, float on money, empty `catch`, `console.*` in server code. A new trap that a regex can catch reliably goes into the hook with a pair of tests (trap / correct code).

**Enforced in the editor and CI** (`Templates/eslint/eslint.config.mjs`): the type-aware half of the same traps, for every contributor, not only agents.

Detect legend: `grep` = a search on the diff · `lint` = an ESLint / Biome rule · `test` = a test that fails · `look` = a short reading check.

## Database round trips

| Trap | Detect | Fix |
|---|---|---|
| Query inside a loop / `map` / per-item resolver (N+1) | `lint` `no-await-in-loop` · `test` query count 1 vs 50 rows | One `IN` / join / `with:` → `quality/performance/query-performance.md` |
| `Promise.all(items.map(query))` | `grep` `Promise.all(.*map(` near `db.` | One batched query |
| Insert / update per row in a loop | `grep` `insert(` or `update(` inside `for` | Multi-row insert, `ON CONFLICT` upsert → `quality/performance/round-trips.md` |
| Settings or reference data read from the DB per request | `test` query log shows `SystemSettings` during a request | Load all at boot, read from memory snapshot → `quality/performance/round-trips.md` |
| Two related settings read at different moments | `look` provider name and key read separately | `GetSettings([...])` from one snapshot |
| `SELECT *` on lists | `grep` `select().from(` in list services | Select the shown columns |
| Filtering / sorting in JS after loading rows | `grep` `.filter(` / `.sort(` on query results | `WHERE` / `ORDER BY` in SQL |
| `COUNT(*)` on a big table every page | `grep` `count(` in list endpoints | Estimate, cached counter or "has more" |
| `IN ()` with an empty list or 10k ids | `test` empty and huge input | Skip when empty; chunk or `= ANY($1)` |
| Missing index on a joined / filtered FK | `look` schema diff · `EXPLAIN` shows Seq Scan | Index; composite: equality columns first |
| Offset pagination on a growing table | `grep` `.offset(` | Keyset for new endpoints or a measured problem; an existing contract keeps its params with `Id` tiebreaker and `Limit` cap |
| `ILIKE '%term%'` without trigram index | `grep` `ilike` | `pg_trgm` GIN or full-text |

## Data correctness

| Trap | Detect | Fix |
|---|---|---|
| `update()` / `delete()` without `.where()` | `grep` `.update(` / `.delete(` lines without `.where(` | Always `.where()` → `Stacks/Database.md` §4 |
| Soft-delete filter forgotten | `grep` queries on soft-deletable tables without `NotDeleted(` or the project's equivalent helper | One shared helper |
| Read-check-write (stock, balance, coupon) | `look` `SELECT` then `UPDATE` of the same row · `test` parallel requests | Atomic conditional update / `FOR UPDATE` / constraint → `backend/data/concurrency.md` |
| Money in floats | `grep` `parseFloat\|toFixed\|real\|double` on money | Integer minor units → `backend/data/money.md` |
| Network call inside a DB transaction | `look` `fetch(` / provider call inside `db.transaction(` | Call outside; outbox or job |
| Timestamps without time zone | `grep` `timestamp(` without `withTimezone: true` | `timestamptz` for new columns; no migration of existing columns without a plan |
| Duplicate submits create duplicates | `test` double POST | Unique natural key / idempotency key → `backend/reliability/idempotency.md` |
| Migration that locks a big table | `look` `ALTER TABLE … NOT NULL` / index without `CONCURRENTLY` | Expand → migrate → contract → `backend/data/migrations.md` |

## Memory

| Trap | Detect | Fix |
|---|---|---|
| Whole table loaded for export / job | `grep` `select().from(` without `.limit(` in exports and jobs | Keyset batches + stream → `quality/performance/memory.md` |
| Global `Map` / array growing per request | `grep` module-level `new Map(` / `[]` that gets `.set` / `.push` in handlers | LRU with `max` + `ttl` |
| No body size limit | `test` 20 MB body → expect 413 | `bodyLimit` + Nginx `client_max_body_size` |
| Upload read fully into memory | `grep` `arrayBuffer()` / `formData()` on upload routes | Stream or presigned upload → `backend/files/uploads.md` |
| Listener / interval per request never removed | `grep` `setInterval(` / `.on(` inside handlers | Clear on close; `AbortController` |

## CPU and event loop

| Trap | Detect | Fix |
|---|---|---|
| `*Sync` call on a request path | `grep -E "Sync\("` | Async API → `quality/performance/event-loop-cpu.md` |
| Nested scan (`map` + `find` / `includes`) over user-sized lists | `grep` `.find(` / `.includes(` inside `.map(` | `Map` / `Set` lookup |
| Unbounded arrays / strings in input | `grep` `z.array(` / `z.string(` without `.max(` | `.max()` in schemas |
| Catastrophic regex on user input | `lint` `regexp/no-super-linear-backtracking` | Linear regex, length cap |
| Heavy work (PDF, Excel, images) in the request | `look` generator libraries called in controllers | Background job or worker |

## Async and errors

| Trap | Detect | Fix |
|---|---|---|
| Promise not awaited (floating) | `lint` `@typescript-eslint/no-floating-promises` | `await`, or hand it to the job queue |
| `async` callback in `forEach` | `lint` `@typescript-eslint/no-misused-promises` | `for … of` or `Promise.all` with a limit |
| Empty `catch` / catch that only logs and continues wrongly | `grep -E "catch \([^)]*\) \{\s*\}"` | Handle or rethrow → `quality/reliability/error-handling.md` |
| Unbounded `Promise.all` over a dynamic list | `grep` `Promise.all(` + `.map(` | `p-limit` |
| Outbound call without timeout | `grep` `fetch(` without `signal` | `AbortSignal.timeout(ms)` → `quality/reliability/timeouts-retries.md` |
| Retry of a non-idempotent call | `look` retry wrapper around POST to a provider | Idempotency key downstream, or no retry |
| `setTimeout` used for scheduled business work | `grep` `setTimeout(` outside tests and monitors | Database-backed job |

## Security quick checks

| Trap | Detect | Fix |
|---|---|---|
| String-built SQL | `grep` `` sql.raw( `` / template literals into queries | Parameters |
| Resource fetched by id without owner / tenant check (IDOR) | `look` `findFirst({ where: eq(X.Id, Id) })` with no user / tenant condition | Scope every query → `backend/auth/rbac.md` |
| Secret or token in logs | `test` grep logs after auth flows | Logger redaction → `quality/observability/logging.md` |
| Different response for "user exists" | `test` known vs unknown email | One generic answer → `backend/auth/password-reset.md` |
| `Bun.env` / `process.env` read outside config | `grep` `env\.` outside `Config/Env.ts` | `GetSetting` → `Stacks/Database.md` §1 |

## Observability

| Trap | Detect | Fix |
|---|---|---|
| `console.log` in server code | `grep` `console\.` | Project logger → `quality/observability/logging.md` |
| Error logged at every layer | `look` `log.error` before `throw` | Log once where handled |
| Health check touching the DB | `look` `/health` handler | DB only in `/ready` → `quality/observability/health-checks.md` |
| Cron job with no success heartbeat | `look` crontab / job definitions | Heartbeat ping → `quality/observability/alerting.md` |
