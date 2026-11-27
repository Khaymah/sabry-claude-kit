# Idempotency

- **Situation:** create-order, pay, charge, refund, transfer, send-message, any POST a client may retry, and every incoming webhook (Stripe, Paymob, Fawry, WhatsApp).
- **Skip when:** the operation is already idempotent: GET, PUT of a full resource, DELETE, or a write whose natural key is unique (one vote per user per poll: a unique constraint is enough).
- **Decision:** retries are made harmless at the database, by a unique constraint that the second attempt hits: a natural key where one exists, otherwise an `Idempotency-Key` stored with the response and replayed.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Web only, no payments; or only incoming webhooks |
| Standard | Payments, or mobile clients on unreliable networks |
| Advanced | A public API used by third parties, or high write volume |

## Rules

### Minimum — always, never cut

- Find the natural key first (cart id → one order, `(UserId, PollId)` → one vote) and put a `UNIQUE` on it. That alone covers most double submits.
- The submit button is disabled while the request runs. Helpful, never the only guard.
- Every incoming webhook: verify the signature, then insert the provider's event id into `ProcessedWebhooks` (unique). On conflict answer `200` and stop.

### Standard — adds

- Money-moving endpoints take an `Idempotency-Key` header (the project's own header or mechanism if it has one); only those, not every POST.
- Uniqueness is per **(scope, key)**, scope = the user or tenant, so nobody can replay another's response.
- Claim the key before the work by inserting `Status = 'Processing'`; the unique constraint, not a prior `SELECT`, decides the winner.
- Same key, different request (hash of method + path + canonical body) → `422` (or the project's validation status). Same key still processing → `409` with `Retry-After`.
- Store the final status and body; a repeat returns them with `Idempotent-Replayed: true`. 4xx is stored and replayed; 5xx or a crash deletes the claim.
- Pass the same key downstream to the payment provider (Stripe `Idempotency-Key`, Paymob `merchant_order_id`), so our retry never charges twice.
- Webhooks are processed in a job; the HTTP handler only records and answers.
- Keys expire after 24 h (`SystemSettings`); a daily job deletes old rows.

### Advanced — adds

- Every POST of the public API accepts the header, and the docs say so.
- The claim can live in Redis (`SET … NX EX`) for throughput; payment endpoints keep the Postgres table.
- A stale `Processing` claim (older than the endpoint's timeout) is reclaimed by a conditional update, with a metric on how often it happens.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Server crashes after the provider charged, before `Completed` was written | The retry reaches the provider with the same key and gets the original charge back; no second charge |
| Process dies, claim stuck in `Processing` | Standard: `409` until the 24 h expiry, and an alert. Advanced: reclaimed after the timeout |
| Same body with keys in a different JSON order | Same hash: the body is canonicalised (sorted keys) before hashing |
| Same key sent to a different endpoint | `422` (or the project's validation status): method and path are part of the hash |
| Client retries after the key expired | Processed as new. Expiry must exceed the client's longest retry window; document it |
| Webhook arrives before our own order row is committed | The job fails with "not found yet" and retries with backoff; it is not dropped |
| Webhooks out of order (refund before payment succeeded) | The handler checks the order's state machine and requeues or ignores transitions that don't apply yet |
| Response is a file or a stream | Not cached: such endpoints use a natural key instead of the replay table |
| 100×: Millions of stored keys | The unique `(Scope, Key)` index keeps lookups constant; expired rows are deleted daily in batches of 10k |
| Twice / parallel: The same key from two devices at once | The unique constraint lets one claim it; the other gets `409` and retries into a replay |

## Example — Standard, Bun + Hono + Drizzle

The sample uses the owner's default header, codes and shape; keep the project's own.

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
  const Body = await c.req.raw.clone().text()
  const RequestHash = await Sha256Hex(`${c.req.method} ${c.req.path} ${CanonicalJson(Body)}`)
  c.set("IdempotencyKey", Key)

  const [Claimed] = await db.insert(IdempotencyKeys)
    .values({ Scope, Key, RequestHash })
    .onConflictDoNothing()
    .returning({ Id: IdempotencyKeys.Id })

  if (!Claimed) {
    const Existing = await db.query.IdempotencyKeys.findFirst({ where: and(eq(IdempotencyKeys.Scope, Scope), eq(IdempotencyKeys.Key, Key)) })
    if (!Existing || Existing.RequestHash !== RequestHash) throw new AppError("IDEMPOTENCY_KEY_REUSED", 422)
    if (Existing.Status === "Processing") {
      c.header("Retry-After", "2")
      throw new AppError("IDEMPOTENCY_IN_PROGRESS", 409)
    }
    c.header("Idempotent-Replayed", "true")
    return c.json(Existing.ResponseBody, Existing.ResponseCode as ContentfulStatusCode)
  }

  const Release = () => db.delete(IdempotencyKeys).where(eq(IdempotencyKeys.Id, Claimed.Id))
  try {
    await Next()
  } catch (Err) {
    await Release()
    throw Err
  }
  if (c.res.status >= 500) return void (await Release())
  await db.update(IdempotencyKeys)
    .set({ Status: "Completed", ResponseCode: c.res.status, ResponseBody: await c.res.clone().json() })
    .where(eq(IdempotencyKeys.Id, Claimed.Id))
})

OrdersRoutes.post("/", Auth, Idempotent, zValidator("json", CreateOrderSchema), OrdersController.Create)
```

The service reads `c.get("IdempotencyKey")` (passed down by the controller) and sends it to the payment provider. Minimum is just the `UNIQUE` on the natural key plus `ProcessedWebhooks`.

Other stacks: Express/Fastify use the same middleware shape; Laravel a middleware with `insertOrIgnore`.

## Verify

- [ ] `[M]` Double-click on submit creates one row (the unique constraint rejects the second).
- [ ] `[M]` The same webhook delivered three times is processed once and gets three `200`s.
- [ ] `[S]` Same request + key twice: one order, identical responses, the second with `Idempotent-Replayed: true`.
- [ ] `[S]` Two identical requests in parallel (`Promise.all`): exactly one processed, the other `409` or a replay.
- [ ] `[S]` Same key with a different body or path: `422`. User A's key cannot replay to user B.
- [ ] `[S]` Handler throws: the key row is gone and a retry succeeds; the provider received the same key both times.
- [ ] `[A]` A claim left in `Processing` past the timeout is reclaimed once.

## Pitfalls

- **`SELECT` the key, then `INSERT`** → two retries both pass → the unique constraint claims it.
- **Key generated per HTTP attempt in the client** → every retry looks new → one key per user action, reused on retries.
- **Caching 5xx** → a transient error becomes permanent for that key → release on 5xx.
- **Not passing the key to the provider** → our safe retry charges the card twice → same key downstream.
- **Heavy webhook processing before answering** → provider timeouts and redelivery storms → record, enqueue, answer.

## Related

`backend/data/money.md` · `backend/data/concurrency.md` · `backend/reliability/background-jobs.md` · `Stacks/Database.md` §5
