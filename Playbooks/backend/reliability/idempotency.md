# Idempotency

- **Situation:** create-order, pay, charge, refund, transfer, send-message, any POST a mobile client may retry on a bad network, and every incoming webhook (Stripe, Paymob, Fawry, WhatsApp). Not needed for GET, or for PUT/DELETE that are naturally idempotent.
- **Decision:** the client sends an `Idempotency-Key` header; the server records key + request hash + response in an `IdempotencyKeys` table with a unique constraint, and replays the stored response on a repeat. Webhooks use the provider's event id the same way.

## Rules

- The key is unique per **(scope, key)**: scope = the authenticated user or tenant, so two customers can't collide or read each other's replay.
- Claim the key **before** doing the work, by inserting a row with `Status = 'Processing'`. The unique constraint, not a prior `SELECT`, decides who wins.
- Same key + different request body → `422 IDEMPOTENCY_KEY_REUSED`. Compare a SHA-256 of the canonical body.
- Same key while the first is still processing → `409 IDEMPOTENCY_IN_PROGRESS` with `Retry-After`. Don't wait inside the request.
- Store the final status code and body; a repeat returns them byte for byte with `Idempotent-Replayed: true`.
- Business failure (card declined, 4xx) is stored and replayed. A crash or 5xx deletes the claim so the client can retry.
- The business write and the `Completed` update share one transaction when they touch the same database.
- Keys expire (24 h default from `SystemSettings`); a daily job deletes old rows.
- Webhooks: verify the signature first, then insert the provider's event id into `ProcessedWebhooks` (unique). On conflict, answer `200` and do nothing. Process in a job; answer the provider fast.
- Clients (web, mobile) generate a UUID per user action, not per HTTP attempt, and reuse it on every retry of that action.

## Example — Bun + Hono + Drizzle

```ts
export const IdempotencyKeys = pgTable("IdempotencyKeys", {
  ...BaseColumns,
  Scope: text("Scope").notNull(),
  Key: text("Key").notNull(),
  RequestHash: text("RequestHash").notNull(),
  Status: text("Status").notNull().default("Processing"),
  ResponseCode: integer("ResponseCode"),
  ResponseBody: jsonb("ResponseBody"),
}, (T) => [uniqueIndex().on(T.Scope, T.Key), check("IdemStatus", sql`${T.Status} IN ('Processing','Completed')`)])

export const Idempotent = createMiddleware<AppEnv>(async (c, Next) => {
  const Key = c.req.header("Idempotency-Key")
  if (!Key || Key.length > 255) throw new AppError("IDEMPOTENCY_KEY_REQUIRED", 400)
  const Scope = c.get("User").Id
  const RequestHash = await Sha256Hex(await c.req.raw.clone().text())

  const [Claimed] = await db.insert(IdempotencyKeys)
    .values({ Scope, Key, RequestHash })
    .onConflictDoNothing()
    .returning({ Id: IdempotencyKeys.Id })

  if (!Claimed) {
    const Existing = await db.query.IdempotencyKeys.findFirst({ where: and(eq(IdempotencyKeys.Scope, Scope), eq(IdempotencyKeys.Key, Key)) })
    if (!Existing || Existing.RequestHash !== RequestHash) throw new AppError("IDEMPOTENCY_KEY_REUSED", 422)
    if (Existing.Status === "Processing") throw new AppError("IDEMPOTENCY_IN_PROGRESS", 409)
    c.header("Idempotent-Replayed", "true")
    return c.json(Existing.ResponseBody, Existing.ResponseCode as ContentfulStatusCode)
  }

  try {
    await Next()
  } catch (Err) {
    await db.delete(IdempotencyKeys).where(eq(IdempotencyKeys.Id, Claimed.Id))
    throw Err
  }
  if (c.res.status >= 500) {
    await db.delete(IdempotencyKeys).where(eq(IdempotencyKeys.Id, Claimed.Id))
    return
  }
  await db.update(IdempotencyKeys)
    .set({ Status: "Completed", ResponseCode: c.res.status, ResponseBody: await c.res.clone().json() })
    .where(eq(IdempotencyKeys.Id, Claimed.Id))
})

OrdersRoutes.post("/", Auth, Idempotent, zValidator("json", CreateOrderSchema), OrdersController.Create)
```

Webhook variant: replace the header with the provider's event id and the scope with the provider name, after signature verification.

Other stacks: Express/Fastify the same middleware shape; Laravel a middleware with `insertOrIgnore`; with Redis instead of Postgres use `SET key value NX EX 86400` for the claim, but keep the Postgres table for payments.

## Verify

- [ ] Same request with the same key twice → one order in the database, identical responses, second has `Idempotent-Replayed: true`.
- [ ] Two identical requests in parallel (`Promise.all`) → exactly one processed, the other `409` or a replay.
- [ ] Same key, different body → `422`.
- [ ] Handler throws → the key row is gone, a retry succeeds.
- [ ] Same webhook delivered three times → processed once, three `200`s.
- [ ] User A's key cannot replay to user B.

## Pitfalls

- **`SELECT` to check the key, then `INSERT`** → two retries both pass the check → the unique constraint claims it.
- **Key generated per HTTP attempt** in the client → every retry is "new" → one key per user action.
- **Caching 5xx responses** → a transient error becomes permanent for that key → delete the claim on 5xx.
- **Global keys without scope** → one user can replay another's response → scope by user or tenant.
- **Heavy webhook processing before answering** → provider timeouts and redelivery storms → record the event id, enqueue, answer `200`.

## Related

`data/money.md` · `data/concurrency.md` · `reliability/background-jobs.md` · `Stacks/Database.md` §5
