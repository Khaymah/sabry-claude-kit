# Notifications fan-out

- **Situation:** one event ("order shipped", "invoice paid", "new comment") must reach the user in the app, by push, email and SMS; user preferences, quiet hours, unread badge, "الاشعار وصل مرتين".
- **Skip when:** one channel only and no preferences (call the channel playbook directly), or a managed service (OneSignal, Knock, Novu) already owns fan-out.
- **Decision:** the business transaction writes the event and its notification rows to an outbox; a job fans out per channel; each delivery has a dedupe key `(UserId, EventId, Channel)` with a unique index, so a retried job never notifies twice. Concrete names and defaults below apply when the project has none; the owner's rules and existing code win. Tenant filter, idempotent handlers and validation at the edge stay absolute.

## Levels

| Level | Pick when |
|---|---|
| Minimum | In-app list plus one outside channel, no preferences |
| Standard | Several channels, per-user preferences, quiet hours, unread counts |
| Advanced | Digest batching, per-tenant templates, delivery analytics, escalation (push, then SMS if unread) |

## Rules

### Minimum — always, never cut

- Insert the `Notifications` row in the same transaction as the business change (`backend/reliability/background-jobs.md` outbox). Never notify from the request after commit "best effort". The job is enqueued after the commit (or by a sweeper that picks `Pending` rows), never by a queue call on another connection inside the business transaction.
- Unique index `(UserId, DedupeKey, Channel)`; the DedupeKey is derived from the event (`Order:123:Shipped`), never from a random id or the job id. Insert with `ON CONFLICT DO NOTHING` and send only when a row was inserted.
- Every query carries the tenant filter and `UserId` from the session (`backend/data/multi-tenancy.md`). A notification id from the client never reads another user's row.
- Sending happens in a job, never inside the request; the job carries ids only.
- Claim before the provider call: `UPDATE … SET "Status" = 'Sending' WHERE "Id" = $1 AND "Status" = 'Pending' RETURNING`; no row back → another worker has it, return. A sweeper returns stale `Sending` rows to `Pending`.
- Mark `Sent` after the provider accepted, `Failed` with the reason otherwise; one channel failing never fails the others.

### Standard — adds

- `NotificationPreferences(UserId, Category, Channel, Enabled)`; missing row means the category default. Security and billing categories cannot be turned off for email.
- Quiet hours stored as local times plus `Africa/Cairo` (or the user's zone), evaluated at send time, not at event time. Push and SMS in quiet hours are deferred to the window end via `startAfter`; in-app is never deferred (`backend/data/time-zones.md`).
- Unread count is a counter query on a partial index `WHERE "ReadAt" IS NULL`, or a cached counter changed in the same transaction as the row; "mark all read" is one `UPDATE … WHERE "UserId" = $1 AND "ReadAt" IS NULL`.
- Render in the user's locale (`ar` default for Egypt) at send time with the template version stored on the row.
- Channel order per category: in-app first, then push, email only if push has no valid token, SMS only for the categories the owner listed (cost).
- A user with no verified phone or no push token skips that channel without an error.

### Advanced — adds

- Digest: collapse N events of one category inside a window into one email or push, with the window key part of the dedupe key.
- Escalation job: if the in-app row is still unread after X minutes, send the next channel once.
- Per-channel delivery metrics (queued, sent, delivered, failed, opened) with an alert on a falling delivery rate.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Job retried after the push was sent but before `Sent` was saved | The dedupe row exists, the retry sees it and skips; if the provider has an idempotency or collapse key it is the same DedupeKey |
| Business transaction rolled back | No notification rows and no jobs exist, because the outbox rows rolled back too |
| Event fires 5 times for one object (user edits fast) | Same DedupeKey scheme per version, or a digest window; never five pushes in a minute |
| Quiet hours 22:00–08:00 and the event is at 23:30 Cairo | In-app now; push and SMS at 08:00 Cairo; DST shifts are handled by the zone, not by a fixed offset |
| User deleted or deactivated before the job runs | Handler loads by id, finds nothing or inactive, completes as a no-op |
| User turns a channel off after the event but before the send | Preferences are read at send time; the row is marked `Skipped` |
| Mark as read from two devices | Idempotent `UPDATE … WHERE "ReadAt" IS NULL`; the unread count never goes negative |
| Tenant admin sends to "all users" | Fan-out job enqueues chunks of 1,000 ids; each chunk is idempotent |
| Data at 100×: 50M notification rows | Unread count uses the partial index; the list is keyset-paged on `(CreatedAt, Id)`; old read rows archived after 90 days |
| Twice / parallel: the same event delivered by two workers | Unique index lets one insert win; the other gets zero rows and stops |
| Old rows with no `DedupeKey` (before this rule) | Backfill with the row id; new code never treats NULL as "unique" |

## Example — Standard, Bun + Hono + Drizzle

```ts
export const Notifications = pgTable("Notifications", {
  ...BaseColumns,
  TenantId: uuid("TenantId").notNull(),
  UserId: uuid("UserId").notNull(),
  Channel: text("Channel").notNull(),
  Category: text("Category").notNull(),
  DedupeKey: text("DedupeKey").notNull(),
  Payload: jsonb("Payload").notNull(),
  Status: text("Status").notNull().default("Pending"),
  ReadAt: timestamp("ReadAt", { withTimezone: true }),
}, (T) => [
  uniqueIndex("NotificationsDedupe").on(T.UserId, T.DedupeKey, T.Channel),
  index("NotificationsUnread").on(T.TenantId, T.UserId).where(sql`${T.ReadAt} IS NULL`),
])

export async function Notify(Tx: Transaction, Event: DomainEvent, Users: string[]): Promise<string[]> {
  const Channels = await ResolveChannels(Tx, Event.Category, Users)
  const Rows = Channels.map((C) => ({
    TenantId: Event.TenantId,
    UserId: C.UserId,
    Channel: C.Channel,
    Category: Event.Category,
    DedupeKey: Event.DedupeKey,
    Payload: Event.Payload,
  }))
  const Inserted = await Tx.insert(Notifications).values(Rows).onConflictDoNothing().returning({ Id: Notifications.Id })
  return Inserted.map((R) => R.Id)
}

export async function EnqueueDeliveries(Ids: string[]) {
  for (const Id of Ids) await Boss.send("DeliverNotification", { NotificationId: Id }, { singletonKey: Id })
}

export async function DeliverNotification(Job: { data: { NotificationId: string } }) {
  const Row = await LoadNotification(Job.data.NotificationId)
  if (!Row || Row.Status !== "Pending") return
  const Pref = await LoadPreference(Row.UserId, Row.Category, Row.Channel)
  if (Pref && !Pref.Enabled) return MarkStatus(Row.Id, "Skipped")
  const Resume = NextAllowedTime(Row, Pref)
  if (Resume) return Boss.send("DeliverNotification", Job.data, { startAfter: Resume })
  const [Claimed] = await Db.update(Notifications).set({ Status: "Sending" }).where(and(eq(Notifications.Id, Row.Id), eq(Notifications.Status, "Pending"))).returning()
  if (!Claimed) return
  try {
    await Adapters[Row.Channel].Send(Row)
  } catch (Error) {
    await MarkStatus(Row.Id, "Failed")
    throw Error
  }
  await MarkStatus(Row.Id, "Sent")
}
```

Call order: `const Ids = await Db.transaction((Tx) => Notify(Tx, Event, Users))`, then `EnqueueDeliveries(Ids)` after it returns.

Other stacks: Laravel notifications with `ShouldQueue` and a unique key, Django with Celery plus a unique constraint; the same dedupe index applies.

## Verify

- [ ] `[M]` Rolling back the business transaction leaves no `Notifications` row and no job.
- [ ] `[M]` Running the delivery job twice for one row sends once (provider mock called once).
- [ ] `[M]` User B requesting user A's notification id gets 404.
- [ ] `[S]` Event at 23:30 Cairo sends push at 08:00 Cairo, in-app immediately.
- [ ] `[S]` Disabling email for a category skips it; security category email still sends.
- [ ] `[S]` Mark-all-read from two parallel requests leaves unread count 0.
- [ ] `[A]` Five events in the digest window produce one email.

## Pitfalls

- **Dedupe key built from the job id or a timestamp** → every retry looks new → derive it from the event.
- **Preferences checked when the event is created** → stale after a long delay → check at send time.
- **Counting unread with `COUNT(*)` on the full table** → slow at scale → partial index or cached counter.
- **Quiet hours with a fixed UTC+2** → wrong after DST → use the IANA zone.
- **One job per user for a broadcast** → queue floods → chunked fan-out.

## Related

`backend/reliability/background-jobs.md` · `backend/reliability/idempotency.md` · `backend/data/time-zones.md` · `backend/data/multi-tenancy.md` · `domains/messaging/email.md` · `domains/messaging/sms.md` · `domains/messaging/push.md` · `domains/messaging/whatsapp.md`
