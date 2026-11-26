# Integration tests on a real database

- **Situation:** setting up tests that touch PostgreSQL, slow or flaky database tests, tests leaking data into each other, CI database setup.
- **Skip when:** code that never touches the database.
- **Decision:** tests run against a real PostgreSQL of the same major version as production. Each test file gets its own fresh database cloned from a migrated template; tests inside a file clean up by `TRUNCATE`. A rolled-back transaction per test is used only where services receive the executor (`Tx`) as a parameter, and never for concurrency tests.

## Levels

| Level | Pick when |
|---|---|
| Minimum | One test database, migrated once, truncated between tests |
| Standard | A template database cloned per test file, files in parallel |
| Advanced | Same plus seeded realistic volume for performance tests |

## Rules

### Minimum — always, never cut

- Never run tests against a database that holds real data. The test database name ends in `_test`, and the setup refuses to run otherwise.
- Migrations run on the test database exactly as in production (`drizzle-kit migrate`), never `push`.
- Each test creates the data it needs; nothing depends on data from another test.
- Between tests: `TRUNCATE` every table except reference tables, `RESTART IDENTITY CASCADE`.

### Standard — adds

- A template database (`app_template_test`) is migrated once per run; each test file creates `app_test_<worker>_<file>` with `CREATE DATABASE … TEMPLATE app_template_test` (about 100 ms) and drops it at the end.
- The app's database client is created from a URL the test setup provides, so the same code runs against each file's database.
- CI: PostgreSQL installed on the runner (GitHub Actions `services: postgres`, or `apt-get install postgresql-16` on a self-hosted runner) with the same major version as production.
- Reference data (roles, settings defaults) comes from the same idempotent migrations as production, not from test fixtures.

### Advanced — adds

- A performance fixture generator fills tables to 100× today's production volume for `EXPLAIN` and load checks.
- `pg_stat_statements` enabled in the test database to fail a test when a query count or plan regresses.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Service opens its own `db.transaction` | Works under the template approach; under the rollback approach it needs a `Tx` parameter, otherwise nested `BEGIN` commits the outer test transaction |
| Concurrency test | Uses real separate connections on its own database; never inside one transaction |
| Tests touching `SystemSettings` | Each file's database has defaults from migrations; tests that change a setting reload the in-memory snapshot |
| `LISTEN/NOTIFY` or advisory locks under test | Real connections required: template approach |
| Developer without Postgres locally | Install it once (`brew install postgresql@16` / `apt-get install postgresql-16`); no Docker needed |
| 100×: hundreds of test files | Databases created per worker, not per file, when creation time dominates; files truncate between each other |
| Twice / parallel: two workers start at once | Unique database names per worker and file; template creation guarded by an advisory lock |

## Example — Standard, Bun

```ts
import { beforeAll, afterAll, afterEach } from "bun:test"
import postgres from "postgres"
import { drizzle } from "drizzle-orm/postgres-js"

const ADMIN_URL = Bun.env.TEST_ADMIN_DATABASE_URL ?? "postgres://localhost/postgres"
const Name = `app_test_${process.pid}_${Math.random().toString(36).slice(2, 8)}`
const Admin = postgres(ADMIN_URL, { max: 1 })
let Client: postgres.Sql

beforeAll(async () => {
  await Admin.unsafe(`CREATE DATABASE "${Name}" TEMPLATE app_template_test`)
  Client = postgres(ADMIN_URL.replace(/\/[^/]*$/, `/${Name}`), { max: 10 })
  UseDatabase(drizzle(Client))
})

afterEach(async () => {
  await Client.unsafe(`TRUNCATE ${MUTABLE_TABLES.map((T) => `"${T}"`).join(", ")} RESTART IDENTITY CASCADE`)
})

afterAll(async () => {
  await Client.end()
  await Admin.unsafe(`DROP DATABASE IF EXISTS "${Name}"`)
  await Admin.end()
})
```

`UseDatabase` swaps the app's `db` instance (exported from `Config/Database.ts`) for tests; `MUTABLE_TABLES` lists every table except reference tables. The template is built once by `bun run test:prepare` (drop, create, migrate). `TEST_ADMIN_DATABASE_URL` is a test-only variable, never present in production.

Other stacks: Laravel `RefreshDatabase` / `DatabaseTransactions`; Rails transactional tests; Prisma with the same template-clone approach.

## Verify

- [ ] `[M]` The setup refuses a database name without `_test`.
- [ ] `[M]` Running the suite twice in a row gives the same result.
- [ ] `[S]` Files run in parallel without failures (`bun test --concurrency` or the runner's default).
- [ ] `[S]` CI uses the production major version (`SELECT version()` in a smoke test).
- [ ] `[A]` A query-plan regression on the volume fixture fails a test.

## Pitfalls

- **SQLite or an in-memory fake in tests, Postgres in production** → JSONB, constraints and locks behave differently → same engine and version.
- **One shared database for parallel files** → random failures → database per file or per worker.
- **Test data from a production dump** → personal data in test environments → factories.

## Related

`quality/testability/test-data.md` · `quality/testability/concurrency-tests.md` · `Stacks/Database.md` §9
