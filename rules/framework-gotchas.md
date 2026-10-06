---
paths:
  - "**/*.ts"
  - "**/*.tsx"
---

# Framework Gotchas

**Hono:** `c.header()` لا ينتقل لـ `new Response()` اليدوي — مرّر headers في الـ constructor.
فضّل `c.json()`/`c.text()`/`c.stream()`. للـ streaming: `c.stream((stream) => {...})`.

**Drizzle + Postgres:** `TEXT` لا `VARCHAR`. كل `WHERE` فيه `eq(T.IsDeleted, false)`.
`update()` **يتطلب `.where()`** — بدونه يُحدّث كل الصفوف. `.returning()` بعد `insert()`.
Base columns: `Id` (uuidv7) · `CreatedAt` · `UpdatedAt` (UTC) · `IsDeleted`.

**TypeScript:** في barrel files استخدم `export { Foo }` لا `export type { Foo }` —
الثانية تنتج `undefined` في runtime.

**Fastify:** لا `res.send()` داخل proxy/stream routes — استخدم `reply.raw`.

**Bun:** `.env` تلقائي — لا `import 'dotenv/config'`. `jose` يعمل نيتيف.
