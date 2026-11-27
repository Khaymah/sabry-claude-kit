# Events and side effects

- **Situation:** "after an order is created also send email / notify / update stock / call a webhook", one action triggering others, a side effect that sometimes runs twice or never.
- **Skip when:** the extra work is a second write in the same database that must succeed or fail together with the first (do it in the same transaction, no event).
- **Decision:** the business write and an `Outbox` row commit in the same transaction; a worker delivers outbox rows at least once; every handler is idempotent. Nothing slow or external (email, HTTP, payment) runs inside the database transaction. An event shape, queue or naming the project already uses wins.

## Levels

| Level | Pick when |
|---|---|
| Minimum | One or two side effects: outbox row plus a polling worker, idempotent handlers |
| Standard | Several consumers or any money/stock effect: processed-events table, per-aggregate ordering, retries with backoff, dead-letter |
| Advanced | High volume or external subscribers: partitioned workers, replay, versioned event schemas |

## Rules

### Minimum — always, never cut

- The outbox row is inserted in the same transaction as the change it describes. Never publish to a queue or call a provider "right after commit" from the request; a crash between the two loses the event.
- Never send email, SMS, HTTP or provider calls inside the database transaction (it holds locks while the network is slow).
- Delivery is at-least-once, so every handler must be safe to run twice (`backend/reliability/idempotency.md`).
- Event payload carries ids and the facts the handler needs (`OrderId`, `TenantId`, amounts in minor units), not a pointer to "whatever the row says now" when the past value matters.
- The worker claims rows with `FOR UPDATE SKIP LOCKED`, so two workers never take the same row (`backend/reliability/background-jobs.md`).

### Standard — adds

- Each handler records `(EventId, Handler)` in a `ProcessedEvents` table with a unique constraint, in the same transaction as its own writes; a duplicate delivery hits the constraint and is skipped.
- A handler that calls an external service uses the event id as the idempotency key towards that service, or checks first and records after.
- Ordering is per aggregate only: events for one `AggregateId` are delivered in `Sequence` order, one at a time; no global ordering is promised.
- Retries use exponential backoff with jitter and a max attempts; after that the row goes to `Status = 'Dead'` and alerts. Never retry forever silently.
- Handlers of different consumers are independent: one failing email never blocks the stock update (separate rows per consumer, or per-handler status).
- Events are named in the past tense for something that already happened (`OrderCreated`, `PaymentCaptured`), never commands.

### Advanced — adds

- Payloads carry a `SchemaVersion`; consumers accept the previous version for one release.
- Published rows older than a retention window are archived or deleted by a job.
- Replay is a documented operation (reset a consumer's cursor), safe because handlers are idempotent.

## Edge cases

| Case | Expected behaviour |
|---|---|
| App crashes after commit, before any delivery | Outbox row exists; the worker delivers it on restart |
| Handler succeeds, crash before marking delivered | Redelivered; `ProcessedEvents` makes the second run a no-op |
| Email provider down for an hour | Retries with backoff; the order is unaffected; after max attempts the row is `Dead` and alerted |
| `OrderCancelled` arrives before `OrderCreated` is handled | Same aggregate is processed in `Sequence` order, so it cannot; across aggregates no order is assumed |
| The transaction rolls back | The outbox row rolls back with it; no phantom email for an order that does not exist |
| An old event is replayed after the code changed | The handler reads the payload's own facts and stays idempotent; it does not recompute from today's prices |
| Data at 100×: millions of outbox rows | Index `(Status, AvailableAt)` partial on pending; delivered rows archived; the worker batches 100 per poll |
| Twice / parallel: events delivered twice, or two workers poll at once | `SKIP LOCKED` stops the second claim; if still delivered twice, `ProcessedEvents` unique `(EventId, Handler)` stops the second effect |

## Example — Standard, Bun + Hono + Drizzle

```ts
export const Outbox = pgTable("Outbox", {
  Id: uuid("Id").primaryKey().defaultRandom(),
  TenantId: uuid("TenantId").notNull(),
  AggregateId: uuid("AggregateId").notNull(),
  Sequence: bigserial("Sequence", { mode: "bigint" }).notNull(),
  Type: text("Type").notNull(),
  Payload: jsonb("Payload").notNull(),
  Status: text("Status").notNull().default("Pending"),
  Attempts: integer("Attempts").notNull().default(0),
  AvailableAt: timestamp("AvailableAt", { withTimezone: true }).notNull().defaultNow(),
})

export const ProcessedEvents = pgTable("ProcessedEvents", {
  EventId: uuid("EventId").notNull(),
  Handler: text("Handler").notNull(),
}, (T) => [primaryKey({ columns: [T.EventId, T.Handler] })])
```

```ts
export async function DeliverBatch() {
  await Db.transaction(async (Tx) => {
    const Rows = await Tx.execute<TOutboxRow>(sql`
      SELECT * FROM "Outbox" O
      WHERE O."Status" = 'Pending' AND O."AvailableAt" <= now()
        AND NOT EXISTS (SELECT 1 FROM "Outbox" E WHERE E."AggregateId" = O."AggregateId" AND E."Status" = 'Pending' AND E."Sequence" < O."Sequence")
      ORDER BY O."Sequence" LIMIT 100
      FOR UPDATE SKIP LOCKED`)
    for (const Row of Rows) await RunHandlers(Tx, Row)
  })
}

async function RunHandlers(Tx: TTx, Row: TOutboxRow) {
  for (const Handler of Handlers[Row.Type] ?? []) {
    const Claimed = await Tx.insert(ProcessedEvents).values({ EventId: Row.Id, Handler: Handler.Name }).onConflictDoNothing().returning()
    if (Claimed.length) await Handler.Run(Tx, Row)
  }
  await Tx.update(Outbox).set({ Status: "Done" }).where(eq(Outbox.Id, Row.Id))
}
```

Handlers that call an external service enqueue a background job from inside `Run` rather than calling the provider while the claim transaction is open.

Other stacks: Laravel `afterCommit` jobs plus an outbox table; Node with BullMQ still needs the outbox row, since the queue and the database do not commit together.

## Verify

- [ ] `[M]` Killing the process between commit and delivery still sends the email after restart.
- [ ] `[M]` No `fetch`, mailer or provider call appears inside a `db.transaction` callback.
- [ ] `[S]` Delivering the same event twice produces one effect (one email, one stock change).
- [ ] `[S]` A handler that always throws ends `Dead` after max attempts and raises an alert.
- [ ] `[A]` Replaying a day of events leaves state unchanged.

## Pitfalls

- **Publishing to the queue after commit** → lost event on crash → outbox row in the transaction.
- **Calling the email API inside the transaction** → locks held during a slow call → outbox and worker.
- **Assuming exactly-once** → duplicate emails or double stock moves → idempotent handlers.
- **One shared status for all consumers** → one bad consumer blocks the rest → per-handler tracking.

## Related

`backend/reliability/background-jobs.md` · `backend/reliability/idempotency.md` · `backend/reliability/outbound-calls.md` · `domains/messaging/notifications.md` · `architecture/layering.md`
