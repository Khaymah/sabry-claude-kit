# Shop Backend

Multi-tenant sales backend: companies (tenants), users and sessions, customers, products, orders, payments.

## Stack
Bun + Hono + Drizzle ORM + PostgreSQL (PGlite in-process) + zod.

## Layout
- `Src/App.ts`: the Hono app; every module is mounted here.
- `Src/Modules/<Module>/<Module>.Routes.ts | .Service.ts | .Schema.ts`: routes, business logic, zod schemas.
- `Src/Database/Schema.ts`: Drizzle tables. `Src/Database/Migrations.ts`: ordered SQL migrations (append new ones, never edit applied ones). Keep both in sync.
- `Src/Database/Db.ts`: the single PGlite client and the Drizzle `Db`.
- `Src/Lib/`: response helpers, validation, money (`ToPiasters` / `FromPiasters`), pagination.
- `Src/Test/Setup.ts` (`ResetDatabase`, `Api`) and `Src/Test/Seed.ts`: test helpers. Tests live in `Tests/`.

## Conventions
- PascalCase for identifiers, files, tables and columns (`Orders`, `CustomerId`).
- Responses: `{ Success: true, Data }` or `{ Success: false, Error: { Code, Message } }`. Throw `AppError(Status, Code, Message)`; the app's error handler formats it.
- Validation errors: 400 `VALIDATION_ERROR`. Missing/foreign resources: 404 `NOT_FOUND`. Auth: 401 `UNAUTHORIZED`, 403 `FORBIDDEN`.
- Every tenant-owned row has `CompanyId`; the current tenant is `C.get("Auth").CompanyId`.
- Money columns are `numeric(12,2)` and come back from Drizzle as strings like `"12.30"`. API money values are strings with 2 decimals.
- Runtime settings live in the `SystemSettings` table (`GetSetting` / `SetSetting`), not env vars.
- Auth: `Authorization: Bearer <Token>`; sessions in `Sessions`.
- Time: business logic reads the time from `Now()` in `Src/Lib/Clock.ts` (tests move the clock), never from SQL `now()`.
- Outbound HTTP uses the global `fetch`; provider URLs, keys and timeouts come from `SystemSettings`.

## Commands
- `bun test` runs the tests.
- `bun run typecheck` runs the type checker.
