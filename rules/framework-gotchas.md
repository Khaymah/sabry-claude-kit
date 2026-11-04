---
paths:
  - "**/*.ts"
  - "**/*.tsx"
---

# Framework gotchas

**Hono:** `c.header()` does not carry into a manual `new Response()` — pass headers in the constructor. Prefer `c.json()` / `c.text()` / `c.stream()`; streaming: `c.stream((stream) => {...})`.

**Drizzle + Postgres:** `TEXT`, not `VARCHAR`. Every `WHERE` includes `eq(T.IsDeleted, false)`. `update()` **requires `.where()`** — without it every row is updated. `.returning()` after `insert()`. Base columns: `Id` (uuidv7) · `CreatedAt` · `UpdatedAt` (UTC) · `IsDeleted`.

**TypeScript:** in barrel files use `export { Foo }`, not `export type { Foo }` — the latter is `undefined` at runtime.

**Fastify:** no `res.send()` inside proxy/stream routes — use `reply.raw`.

**Bun:** `.env` loads automatically — no `import 'dotenv/config'`. `jose` works natively.
