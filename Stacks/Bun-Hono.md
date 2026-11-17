# Bun + Hono + Drizzle + PostgreSQL

The default backend stack. Database rules, `SystemSettings` and migrations: **`Stacks/Database.md`** (read it before any schema or configuration work).

---

## Runtime — Bun

- Bun reads `.env` by itself: never `import "dotenv/config"`.
- Prefer what Bun ships before adding a package: `Bun.password` (argon2id) for password hashing, `bun:test` for tests, `Bun.file` / `Bun.write` for files, Web Crypto for hashing and AES.
- `jose` for JWT (Web Crypto, no polyfill).
- Commands: `bun install` · `bun add` · `bun run dev` · `bun test` · `bunx tsc --noEmit`.

## Framework — Hono

- `c.json()` / `c.text()` / `c.stream()` carry the headers set with `c.header()`; a hand-built `new Response()` does not, so pass headers in its constructor.
- Real streaming: `c.stream()` / `streamSSE()`, not `new Response(ReadableStream)`.
- Middleware order matters: global middleware before route middleware.
- Share request data with `c.set()` / `c.get()`, typed through the app's `Variables`.
- Validate every input at the route with `@hono/zod-validator` and read it with `c.req.valid()`.

---

## Configuration

The environment holds four values; everything else is a `SystemSettings` row.

```ts
export const Env = z.object({
  DATABASE_URL: z.string().url(),
  SETTINGS_ENCRYPTION_KEY: z.string().refine((V) => Buffer.from(V, "base64").length === 32),
  APP_ENV: z.enum(["development", "staging", "production"]),
  PORT: z.coerce.number().int().default(3000),
}).parse(Bun.env)
```

- `Modules/Settings/` owns the registry, the cache, encryption and the admin routes (pattern in `Stacks/Database.md` §1).
- Services read settings through `GetSetting("Key")` from the cache, never from the table per request and never from `Bun.env`.
- Boot order in `Server.ts`: parse `Env` → open the pool → load and validate settings (fail fast in production) → start listening.

---

## Architecture — modular monolith

```tree
Src/
├── App.ts                     routes mounting only
├── Server.ts                  boot order above, graceful shutdown
├── Config/
│   ├── Env.ts                 the four environment values
│   ├── Database.ts            Drizzle + one pool
│   └── Logger.ts              pino
├── Core/
│   ├── Middleware/            Auth, Rbac, RateLimit, Csrf, Hmac, Lang, Logger, Error
│   ├── Errors/                App.Errors.ts
│   ├── Response/              Response.Helper.ts
│   ├── EventBus/              EventBus.ts, Events.Registry.ts
│   └── Utils/                 only what two modules share
├── Modules/
│   ├── Settings/              Settings.Registry.ts, Settings.Service.ts, Settings.Crypto.ts, Settings.Routes.ts
│   └── [Module]/
│       ├── [Module].Routes.ts       routes and middleware only
│       ├── [Module].Controller.ts   parse, call the service, respond
│       ├── [Module].Service.ts      business logic
│       ├── [Module].Schema.ts       Zod schemas
│       ├── [Module].Events.ts       event handlers
│       ├── Models/[Entity].Model.ts Drizzle tables
│       └── Test/                    Unit, Integration, E2E
└── Database/
    ├── Schema.ts              re-exports every table
    └── Migrations/            generated, reviewed SQL
```

| File | Owns | Never |
|---|---|---|
| `Routes.ts` | paths, middleware, validators | logic |
| `Controller.ts` | read validated input, call the service, shape the response | queries |
| `Service.ts` | business rules, transactions | HTTP objects |
| `Model.ts` | table definitions | queries |

---

## Naming — mandatory

| Kind | Convention | Example |
|---|---|---|
| Variables, functions, files, folders | PascalCase | `GetUserById`, `Auth.Controller.ts` |
| Interfaces / types / enums | `I` / `T` / `E` + PascalCase | `IUserPayload`, `TApiResponse`, `EUserRole` |
| Constants | UPPER_SNAKE_CASE | `MAX_RETRIES` |
| Tables · columns | PascalCase (tables plural) | `RefreshTokens.UserId` |
| Setting keys | Namespaced PascalCase | `Payments.Paymob.ApiKey` |
| API routes | kebab-case | `/api/v1/auth/sign-in` |

---

## Drizzle

```ts
export const BaseColumns = {
  Id: uuid("Id").primaryKey().$defaultFn(() => uuidv7()),
  CreatedAt: timestamp("CreatedAt", { withTimezone: true }).notNull().defaultNow(),
  UpdatedAt: timestamp("UpdatedAt", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  IsDeleted: boolean("IsDeleted").notNull().default(false),
}
```

- `update()` and `delete()` always have `.where()`; without it every row changes.
- The soft-delete filter comes from one helper (`NotDeleted(Table)`), not from memory.
- `.returning()` after `insert()` / `update()` instead of a second read.
- Relational queries (`db.query.X.findMany({ with: … })`) or joins: no query inside a loop.
- Transactions: `db.transaction(async (Tx) => …)`, passing `Tx` down; nothing awaits the network inside.
- Concurrency, pagination, money, enums, translation tables, migrations: `Stacks/Database.md`.

---

## Auth

- Access token: short-lived JWT (`jose`) in the `Authorization: Bearer` header. Refresh token: rotating, stored hashed, in an `httpOnly; Secure; SameSite` cookie.
- Passwords: `Bun.password.hash` (argon2id) and `Bun.password.verify`.
- Authentication and permission checks in route middleware, never inside controllers.
- Signing secrets that are not bootstrap values live in `SystemSettings` as secrets.

## Responses

```ts
{ Success: true, Data: {}, Message: "i18n.key", Meta: { Page, Limit, Total } }
{ Success: false, Error: { Code: "AUTH_INVALID", Message: "translated", Details: [] } }
```

Errors are `App.Errors.ts` classes mapped by the error middleware; no raw stack traces leave the server.

---

## Code quality — checklist

```txt
[ ] No comments (only `IMPORTANT:` and `shortcut: <limit>, <when to upgrade>`)
[ ] Smallest complete change: reuse before adding, no dependency for a few lines
[ ] PascalCase for every identifier, I/T/E prefixes
[ ] Zod validation on every input at the route
[ ] Config from SystemSettings via GetSetting; Bun.env read only in Config/Env.ts
[ ] Routes → Controller → Service → Model, no layer skipped
[ ] App.Errors classes and the shared response shape
[ ] UUIDv7 keys, timestamptz, soft delete through one helper
[ ] No query in a loop; keyset pagination for growing lists
[ ] No read-check-write; atomic update, FOR UPDATE or a constraint
[ ] Events for side effects; database-backed jobs, never setTimeout for scheduled work
[ ] I18n message keys, no hardcoded user-facing strings
[ ] No `any`: `unknown` and narrowing
[ ] 600 lines per file at most
[ ] A test for every new branch, money or security path
```

## File size — 600 lines maximum

Split by responsibility (`Auth.Service.ts` → `Auth.Core.ts` · `Auth.OAuth.ts` · `Auth.Sessions.ts`); the original file becomes a barrel. Tests, seeds and catalog files are exempt.

## TypeScript

- `export type { X }` exports the type only; barrels use `export { X }`.
- `unknown` + narrowing instead of `any`.

## Performance

- Stateless processes, so they scale horizontally; sessions, rate limits and caches in Redis when there is more than one instance.
- Settings and other hot reference data cached in memory and invalidated by `NOTIFY`.
- SSE for long responses; one database pool per process.

## Testing

- `bun test`, under `Module/Test/` (Unit, Integration, E2E).
- Integration tests hit a real PostgreSQL inside a rolled-back transaction; mock only external HTTP.
- A race (stock, coupons, balances) is tested with concurrent requests, not reasoned about.
