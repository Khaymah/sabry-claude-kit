# Mobile push

- **Situation:** push to Android and iOS apps (FCM, APNs through FCM), device tokens, "الاشعار مش بيوصل", badge, deep link on tap, silent push to refresh data.
- **Skip when:** web push only (different keys and service worker), or the app has no logged-in users to target.
- **Decision:** FCM HTTP v1 for both platforms (APNs is reached through FCM); a `DeviceTokens` table keyed by token with owner, platform and last-seen; invalid tokens are deleted on the provider's error; one notification per device by dedupe key and collapse id. Field names and limits are defaults when the project has none; the owner's rules win. Tenant and user scoping stay absolute.

## Levels

| Level | Pick when |
|---|---|
| Minimum | One app, register token on login, send to a user |
| Standard | Production: token lifecycle, cleanup, per-device dedupe, deep links, preferences |
| Advanced | Topics, silent data pushes at scale, per-tenant FCM projects, delivery analytics |

## Rules

### Minimum — always, never cut

- The app sends its token to `POST /devices` after login and on every `onTokenRefresh`; the server upserts by `Token` (unique) and sets `UserId` from the session, never from the body.
- A token belongs to one user at a time: registering a token already held by another user moves it (shared phone, logout then login) in one statement.
- On logout the app calls `DELETE /devices/{id}`; the server also deletes when a send returns `UNREGISTERED` or `INVALID_ARGUMENT` for the token. Never keep retrying a dead token.
- Send from a job (`backend/reliability/background-jobs.md`) with ids only; load tokens fresh at send time, every query tenant-scoped (`backend/data/multi-tenancy.md`).
- Service-account credentials come from secrets config; never ship them in the app.

### Standard — adds

- Payload ≤ 4 KB (FCM limit; keep data under ~3 KB). Put an id and a type in `data`, not the full record; the app fetches details when opened (stale or sensitive data should not sit on a lock screen).
- Visible push: `notification` (title, body) plus `data`; text in the user's locale (`ar` default for Egypt). Silent push: `data` only with `content-available: 1` on iOS and priority normal; it is best-effort, throttled by the OS and never a delivery guarantee or a way to run business logic.
- Deep link: `data.Link` holds a route (`/orders/123`), validated by the app against its own router; never an arbitrary URL opened without a host allow-list. Cold start, background and foreground taps all handled.
- Per-device dedupe: `(DeviceId, DedupeKey)` unique on `PushSends`; `collapse_key` (Android) and `apns-collapse-id` (iOS) replace an earlier unseen notification of the same kind.
- Respect preferences and quiet hours (`domains/messaging/notifications.md`); use TTL (for example 4 hours for "driver arriving") so a stale push is dropped, not delivered tomorrow.
- Android 13+ and iOS need a runtime permission; the server stores `PushEnabled` from the app so it skips devices that declined.
- Send in batches of up to 500 per call, within the provider rate limit; handle per-token results independently.

### Advanced — adds

- Topics for broad segments, but authorisation stays server-side: a topic subscription is never the access control.
- Token hygiene job: delete tokens not seen for 60 days; the provider treats stale tokens as invalid anyway.
- Per-platform delivery and open metrics; alert on a rising `UNREGISTERED` rate after a release.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Token refreshed while a send is in flight | The old token returns `UNREGISTERED`; delete it, the new token is already registered |
| Two users log in on one phone | The token moves to the latest user; the first user stops receiving on that device |
| User has 4 devices | One send row per device; read on one device marks the notification read for all (in-app state), later pushes unaffected |
| App uninstalled | The provider reports invalid only after some time; first sends may "succeed", then the token is removed |
| iOS app on a simulator or a wrong APNs key | Send fails for that platform only; Android tokens still deliver; alert on the config |
| Payload over 4 KB | Rejected by FCM; the builder truncates the body and logs; the data carries ids only |
| Tap on a push for a deleted order | The app shows a "no longer available" screen, not a crash or a blank page |
| User signed out when the push arrives | The tap opens login, then routes to the deep link after sign-in |
| Data at 100×: 5M tokens, broadcast | Chunked fan-out jobs of 500 per call, rate limited; a topic is cheaper than per-token sends |
| Twice / parallel: the job retried after partial success | Per-token `PushSends` rows with a unique dedupe key; only unsent tokens are retried |
| Old rows: tokens with no `Platform` | Backfill from the registering app version or delete; new code never sends to unknown platforms |

## Example — Standard, Bun + Hono + Drizzle

```ts
export const DeviceTokens = pgTable("DeviceTokens", {
  ...BaseColumns,
  TenantId: uuid("TenantId").notNull(),
  UserId: uuid("UserId").notNull(),
  Token: text("Token").notNull().unique(),
  Platform: text("Platform").notNull(),
  PushEnabled: boolean("PushEnabled").notNull().default(true),
  LastSeenAt: timestamp("LastSeenAt", { withTimezone: true }).notNull().defaultNow(),
})

App.post("/devices", RequireAuth, async (C) => {
  const Body = DeviceSchema.parse(await C.req.json())
  const User = C.get("User")
  await Db.insert(DeviceTokens).values({ TenantId: User.TenantId, UserId: User.Id, Token: Body.Token, Platform: Body.Platform })
    .onConflictDoUpdate({ target: DeviceTokens.Token, set: { TenantId: User.TenantId, UserId: User.Id, PushEnabled: Body.PushEnabled, LastSeenAt: new Date() } })
  return C.json({ Ok: true })
})

export async function SendPush(UserId: string, TenantId: string, Message: PushMessage) {
  const Devices = await Db.select().from(DeviceTokens).where(and(eq(DeviceTokens.TenantId, TenantId), eq(DeviceTokens.UserId, UserId), eq(DeviceTokens.PushEnabled, true)))
  for (const Device of Devices) {
    const [Row] = await Db.insert(PushSends).values({ DeviceId: Device.Id, DedupeKey: Message.DedupeKey }).onConflictDoNothing().returning()
    if (!Row) continue
    const Result = await Fcm.Send(Device.Token, Message)
    if (Result.Code === "UNREGISTERED" || Result.Code === "INVALID_ARGUMENT") await Db.delete(DeviceTokens).where(eq(DeviceTokens.Id, Device.Id))
  }
}
```

## Verify

- [ ] `[M]` Registering a token held by another user moves it; the old user gets no push on that device.
- [ ] `[M]` An `UNREGISTERED` result deletes the token and it is not retried.
- [ ] `[M]` The user id in the body of `POST /devices` is ignored; the session decides.
- [ ] `[S]` A payload over 4 KB is rejected before the provider call or truncated to ids only.
- [ ] `[S]` Job retried after one device failed sends only to the unsent devices.
- [ ] `[S]` Deep link works on cold start, background and foreground; an unknown route opens a safe screen.
- [ ] `[A]` A 100k-token broadcast stays under the provider rate limit with no duplicate per device.

## Pitfalls

- **Keying tokens by user only** → stale tokens pile up and a shared phone gets the wrong user's push → unique by token, move on re-register.
- **Treating silent push as reliable sync** → missed updates → pull on app open, push only as a hint.
- **Full order data in the payload** → sensitive data on the lock screen and size errors → id plus type.
- **No TTL** → "your driver has arrived" lands tomorrow → set TTL per category.
- **Arbitrary URL in the deep link** → open-redirect or phishing → route allow-list.

## Related

`backend/reliability/background-jobs.md` · `backend/data/multi-tenancy.md` · `backend/reliability/idempotency.md` · `domains/messaging/notifications.md`
