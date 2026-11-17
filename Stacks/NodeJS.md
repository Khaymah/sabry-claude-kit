# Node.js Stack (Express / Fastify)

## Setup

- Package manager: `npm` / `yarn` / `pnpm`
- Run: `node dist/index.js` / `nodemon src/index.ts`
- Test: `jest` / `vitest`
- Typecheck: `npx tsc --noEmit`

## Express

```typescript
import express, { Request, Response, NextFunction } from 'express';

// ❌ ممنوع في proxy/stream routes
res.send(stream)   // يكسر الـ proxy context

// ✅ بدلاً منه
stream.pipe(res)
res.write(chunk) / res.end()
```

## Fastify

- لا `res.send()` داخل proxy/stream routes — يكسر الـ proxy context
- استخدم `reply.raw` أو ارجع الـ stream مباشرة
- Plugins: `fastify.register(plugin, opts)`
- Schema validation مدمج — استخدمه لكل route

```typescript
// ✅ Fastify streaming
fastify.get('/download', async (req, reply) => {
    const stream = createReadStream(filePath);
    return reply.send(stream);   // ✅
    // reply.raw.pipe(stream);   // ✅ بديل للـ proxy context
});
```

## Project Structure

```tree
src/
├── index.ts         ← Entry point
├── app.ts           ← Express/Fastify setup
├── config/          ← env, constants
├── routes/          ← Route definitions
├── controllers/     ← Request handling
├── services/        ← Business logic
├── models/          ← Data types + DB schemas
├── middleware/      ← Auth, logger, error handler
└── utils/           ← Shared helpers
```

## Configuration

Node 20.6+ reads a `.env` file with `node --env-file=.env` (no `dotenv` package). The environment holds only `DATABASE_URL`, `SETTINGS_ENCRYPTION_KEY`, `APP_ENV` and `PORT`, validated once with Zod in `config/env.ts`; every other setting is a `SystemSettings` row read through the settings cache (`Stacks/Database.md` §1).

## TypeScript Re-exports

- `export type { Foo }` = type فقط → لا تعمل للقيمة في runtime
- `export { Foo }` = القيمة والـ type → استخدم هذا في barrel files

## Error Handling

```typescript
// Global error handler — يجب أن يكون آخر middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    console.error(err);
    res.status(500).json({ Success: false, Error: { Message: err.message } });
});

// Async errors — wrap أو استخدم express-async-errors
app.get('/route', async (req, res, next) => {
    try { ... } catch (err) { next(err); }
});
```

## Database

- **Prisma** أو **Drizzle** للـ type-safe ORM
- لا SQL string concatenation — استخدم parameterized queries
- Connection pool: أهم للـ production

## Auth

- `jsonwebtoken` لـ JWT (Node.js)
- `bcrypt` لـ password hashing
- `express-session` أو JWT stateless

## Testing (Jest / Vitest)

```typescript
describe('UserService', () => {
    it('should return user by id', async () => {
        const user = await userService.getById(1);
        expect(user).toBeDefined();
        expect(user.id).toBe(1);
    });
});
```

## Common Gotchas

- `process.env` أسماؤها كـ strings — استخدم Zod للـ validation
- Event loop blocking: لا `fs.readFileSync` في production routes
- Memory leaks: أغلق DB connections والـ intervals عند shutdown
- `req.body` يحتاج `express.json()` middleware

---

## Configuration and database

- **Database work follows `Stacks/Database.md`:** UUIDv7 keys, `timestamptz`, money as integer minor units, constraints in the database, keyset pagination, no read-check-write, reviewed migrations with expand → migrate → contract.
- **Runtime configuration lives in the `SystemSettings` table** (`Stacks/Database.md` §1), not in environment variables. The environment holds only `DATABASE_URL`, `SETTINGS_ENCRYPTION_KEY`, `APP_ENV` and `PORT`. Secrets in the table are AES-256-GCM encrypted and write-only through the API. Settings are read from an in-process cache refreshed on change, never queried per request.
- Node: `node:crypto` (`createCipheriv("aes-256-gcm")`) for secrets; one `pg` pool per process; refresh the cache with `LISTEN` on a dedicated client.
