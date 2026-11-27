# Background jobs

- **Situation:** sending emails and SMS, processing webhooks, generating PDFs and reports, imports, image processing, syncing with providers, scheduled tasks (daily reports, expiring reservations, purges), anything slow or retried.
- **Skip when:** the work is fast (< ~200 ms), must finish before the response, and can't fail independently.
- **Decision:** a PostgreSQL-backed queue (`pg-boss`), so no extra infrastructure: jobs are enqueued with small payloads (ids), handlers are idempotent, retries use exponential backoff, failures end in a visible dead state, and schedules are queue crons, never `setTimeout` or system cron calling HTTP.

## Levels

| Level | Pick when |
|---|---|
| Minimum | A few job types on one server |
| Standard | Production: retries, dedupe keys, dead-letter visibility, transactional enqueue |
| Advanced | High volume: separate worker processes, priorities, Redis-backed queue (BullMQ) if Postgres becomes the bottleneck |

## Rules

### Minimum — always, never cut

- Payload carries ids and parameters, never whole records or secrets: the handler loads fresh data.
- Every handler is idempotent: running it twice has the same effect (check state before acting, use idempotency keys with providers).
- Scheduled work uses the queue's scheduler (`Boss.schedule`), never `setInterval` / `setTimeout` in the web process.
- A job that fails throws; the queue records the error and retries. No swallowed errors inside handlers.

### Standard — adds

- Retry policy per job type: `retryLimit` 5, `retryBackoff: true`, `retryDelay` start 30 s; non-retryable failures (`4xx` business errors) complete with a recorded reason instead of retrying.
- Deduplication with `singletonKey` (e.g. `Report:<Id>:<Date>`) for jobs that must not run twice concurrently or be enqueued twice.
- Enqueue in the same transaction as the business write when the job must exist if and only if the write committed: an `Outbox` row written in the transaction, moved to the queue by a poller; or the queue's transactional send if available.
- Concurrency per queue (`batchSize`, `teamSize`) below the database pool and provider limits.
- Failed jobs (retries exhausted) are visible on an admin page or alert; they can be retried by an operator.
- Each handler logs `JobId`, name, attempt and `ParentRequestId` (`quality/observability/request-correlation.md`).
- Workers run in the same process for small apps or a separate PM2 app (`worker.ts`) when CPU-heavy; both drain on shutdown (`quality/reliability/graceful-shutdown.md`).

### Advanced — adds

- Separate worker processes per heavy queue, scaled independently.
- Priorities: payment webhooks and user-facing jobs ahead of bulk work.
- Queue depth and oldest-job age as metrics with alerts.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Record deleted before its job runs | Handler loads by id, finds nothing, completes as a no-op with a log line |
| Provider down for hours | Retries back off; after the limit the job is failed and alerted, then re-run by an operator |
| Job enqueued but transaction rolled back | Outbox pattern: no job exists, because the outbox row rolled back too |
| Long job (10 min) and a deploy | Worker stops taking new jobs; the long job finishes within the deadline or is retried, idempotently |
| Cron fires while the previous run is still going | `singletonKey` per schedule window prevents overlap |
| 100×: 1M emails for a campaign | One batching job that enqueues chunks of 1,000, provider bulk API, rate limit below the provider's |
| Twice / parallel: the same job delivered to two workers | The queue's locking prevents it; the idempotent handler makes it harmless anyway |

## Example — Standard, Bun + pg-boss

```ts
import PgBoss from "pg-boss"

export const Boss = new PgBoss({ connectionString: Env.DATABASE_URL, schema: "jobs" })

export async function StartJobs() {
  await Boss.start()
  await Boss.createQueue("Email.OrderConfirmation", { retryLimit: 5, retryBackoff: true, retryDelay: 30 })
  await Boss.createQueue("Reservations.Expire")
  await Boss.schedule("Reservations.Expire", "* * * * *")
  await Boss.work("Email.OrderConfirmation", { batchSize: 5 }, async (Jobs) => {
    await Promise.all(Jobs.map((Job) => SendOrderConfirmation(Job.data.OrderId, Job.id)))
  })
  await Boss.work("Reservations.Expire", async () => ExpireReservations())
}

export async function SendOrderConfirmation(OrderId: string, JobId: string) {
  const Order = await GetOrderForEmail(OrderId)
  if (!Order || Order.ConfirmationSentAt) return
  await Mailer.Send({ To: Order.Email, Template: "OrderConfirmation", Data: Order, IdempotencyKey: `order-confirmation:${OrderId}` })
  await db.update(Orders).set({ ConfirmationSentAt: sql`now()` }).where(and(eq(Orders.Id, OrderId), isNull(Orders.ConfirmationSentAt)))
  Logger.info({ JobId, OrderId }, "order confirmation sent")
}

await Boss.send("Email.OrderConfirmation", { OrderId }, { singletonKey: `order-confirmation:${OrderId}` })
```

`batchSize: 5` bounds the `Promise.all`. `ConfirmationSentAt` plus the provider idempotency key make a retry after a crash safe. Check the `pg-boss` major version's API when installing; queue options moved between majors.

Other stacks: `graphile-worker` (Postgres, transactional `add_job` in SQL); BullMQ when Redis already exists; Laravel queues with the database driver.

## Verify

- [ ] `[M]` `grep -rn "setTimeout\|setInterval" Src/` finds no scheduled business work.
- [ ] `[M]` Running a handler twice for the same id sends one email (test).
- [ ] `[S]` A job failing 5 times appears as failed with its error and can be retried.
- [ ] `[S]` A rolled-back order leaves no job behind (outbox test).
- [ ] `[S]` `pm2 reload` during a running job: finished or retried once, no duplicate effect.
- [ ] `[A]` Queue depth and oldest-job age are on a dashboard with alerts.

## Pitfalls

- **Whole objects in the payload** → stale data, secrets in the jobs table → ids.
- **Non-idempotent handlers** → duplicate emails and charges on retry → check state + provider keys.
- **Fire-and-forget promises instead of jobs** → lost work on restart, no retries → queue.

## Related

`backend/reliability/idempotency.md` · `backend/reliability/outbound-calls.md` · `quality/reliability/graceful-shutdown.md` · `quality/reliability/backpressure.md`
