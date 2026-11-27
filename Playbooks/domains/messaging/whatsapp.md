# WhatsApp Business (Cloud API)

- **Situation:** order updates, OTP, support chat or reminders over WhatsApp; "الرسالة اتبعتت ومحدش استلم", template approval, "24 ساعة", inbound customer replies and media.
- **Skip when:** a managed inbox (a BSP dashboard) is all that is needed and no code sends or receives, or SMS and push are enough.
- **Decision:** use Meta's WhatsApp Cloud API through an adapter; business-initiated messages use approved templates, free-form text only inside the 24-hour window since the user's last message; every contact has a recorded opt-in; inbound webhooks verify the signature on the raw body and dedupe by message id. Template names, window handling and storage names are defaults when the project has none; the owner's provider (Cloud API or a BSP) wins. Idempotency and validation at the edge stay absolute.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Outbound approved templates only (alerts, OTP) |
| Standard | Two-way: inbound webhook, session replies, opt-in, media |
| Advanced | Multiple numbers, per-tenant WABA, quality-rating monitoring, template analytics |

## Rules

### Minimum — always, never cut

- Record opt-in before the first message: `WhatsAppOptIns(Phone E.164, Source, GrantedAt, RevokedAt)`. No row or a revoked row means no send.
- Business-initiated messages use a template that Meta approved (category utility, authentication or marketing); a rejected or pending template is never sent. Variables are filled from data, never from raw user text without length and character checks.
- Normalise the number to E.164 without `+` as WhatsApp expects (`201012345678`); `domains/messaging/sms.md` has the Egyptian rules.
- Send from a job with a dedupe key (`backend/reliability/background-jobs.md`); store the returned `wamid` per row.
- Honour opt-out: a "STOP" or block event sets `RevokedAt` immediately and cancels queued sends.

### Standard — adds

- Webhook `GET` answers the verify challenge only when the verify token matches; `POST` verifies `X-Hub-Signature-256` (HMAC-SHA256 with the app secret) on the raw body before parsing, compared in constant time after a byte-length check (compare buffers, not string lengths).
- Return 200 fast and process in a job; Meta retries on non-200 and sends the same event more than once. Dedupe inbound by message `id` with a unique index; status events (`sent`, `delivered`, `read`, `failed`) only move forward.
- 24-hour window: store `LastInboundAt` per contact. Inside it, free-form replies are allowed; outside it, only templates. Check at send time, not at enqueue time, because a queued message can cross the boundary.
- Media: the webhook gives a media id, not a file. Download within minutes (the URL needs the bearer token and expires; media is kept by Meta about 30 days), copy to your own storage (`backend/files/uploads.md`), and store your own key. Validate type and size before keeping it.
- Template changes go through a table `WhatsAppTemplates(Name, Language, Status, Category)` synced from the status webhook; `ar` and `en` are separate language versions, each approved on its own.
- Pricing is per conversation or per message category; keep a daily spend cap like SMS.

### Advanced — adds

- Watch the quality rating and messaging-limit tier; alert on a drop and pause marketing sends before the number is restricted.
- Per-tenant WABA and token stored encrypted; a tenant never reads another tenant's inbound.
- Fallback chain per category: WhatsApp, then SMS if the status is `failed` or undelivered after a timeout, once only.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Customer replies 25 hours after our last template | The reply opens a new window; our reply is free-form only after their message |
| Job queued at 23:50 of hour 23, runs after the window closed | The send step re-checks the window; it switches to a template or stops, never sends free text |
| Template approved in `en`, order is for an Arabic user with no `ar` version | Send the approved language only; a missing `ar` template is a config alert, not a machine translation |
| Number is not on WhatsApp | `failed` status with the code; mark the contact unreachable and use the next channel |
| Same inbound message delivered 3 times | Unique `id` index; one stored row, one reply job |
| Status `delivered` arrives before `sent` | Status ranks `sent` < `delivered` < `read`; an older rank never overwrites |
| Inbound image, then the user deletes it | Our stored copy follows our retention rule; Meta's link is dead after expiry |
| Webhook signature computed on parsed JSON | Fails on any whitespace difference; compute on the raw bytes |
| Data at 100×: 20M messages | Partition `WhatsAppMessages` by month, index `(Wamid)` and `(ContactId, CreatedAt)`; media in object storage, not the table |
| Twice / parallel: user taps "send again" | Dedupe key per `(Phone, Template, Reference)`; the second returns the first row |

## Example — Standard, Bun + Hono + Drizzle

```ts
App.get("/webhooks/whatsapp", (C) => {
  const Ok = C.req.query("hub.mode") === "subscribe" && C.req.query("hub.verify_token") === Env.WHATSAPP_VERIFY_TOKEN
  return Ok ? C.text(C.req.query("hub.challenge") ?? "") : C.text("Forbidden", 403)
})

App.post("/webhooks/whatsapp", async (C) => {
  const Raw = await C.req.text()
  const Expected = "sha256=" + createHmac("sha256", Env.WHATSAPP_APP_SECRET).update(Raw).digest("hex")
  const Given = Buffer.from(C.req.header("x-hub-signature-256") ?? "")
  const Wanted = Buffer.from(Expected)
  if (Given.byteLength !== Wanted.byteLength || !timingSafeEqual(Given, Wanted)) return C.text("Invalid", 401)
  for (const M of ExtractInbound(JSON.parse(Raw))) {
    const [Row] = await Db.insert(WhatsAppMessages).values(M).onConflictDoNothing().returning({ Id: WhatsAppMessages.Id })
    if (Row) await Boss.send("ProcessInbound", { MessageId: Row.Id })
  }
  return C.text("Ok")
})

export async function SendWhatsApp(ContactId: string, Body: SendBody, Now: Date) {
  const Contact = await LoadContact(ContactId)
  if (!Contact.OptedIn) throw new AppError("WHATSAPP_NO_OPT_IN", 409)
  const InWindow = Contact.LastInboundAt && Now.getTime() - Contact.LastInboundAt.getTime() < 24 * 3_600_000
  if (Body.Kind === "Text" && !InWindow) throw new AppError("WHATSAPP_WINDOW_CLOSED", 409)
  return Adapter.Send(Contact.Phone, Body)
}
```

## Verify

- [ ] `[M]` A contact with no opt-in row is never sent a message.
- [ ] `[M]` An unapproved template is blocked before the provider call.
- [ ] `[S]` A free-form send at 25 h returns `WHATSAPP_WINDOW_CLOSED`; at 23 h it succeeds.
- [ ] `[S]` The same webhook body posted three times creates one message row and one job.
- [ ] `[S]` A wrong signature or a signature over re-serialised JSON gets 401.
- [ ] `[S]` An inbound image is copied to our storage and the stored key still opens after the Meta URL expires.
- [ ] `[A]` A falling quality rating pauses marketing sends and alerts.

## Pitfalls

- **Treating the 24-hour window as fixed at enqueue time** → rejected sends after delay → check at send.
- **Returning 500 on duplicate inbound** → Meta retries harder → ignore the duplicate and return 200.
- **Storing the media URL** → dead link in a day → copy the bytes.
- **Marketing to contacts who only opted in to alerts** → blocks and quality drop → opt-in per purpose.
- **Machine-translated template text** → rejection or wrong tone → separate approved language versions.

## Related

`backend/auth/otp.md` · `backend/reliability/background-jobs.md` · `backend/reliability/idempotency.md` · `backend/files/uploads.md` · `domains/messaging/sms.md` · `domains/messaging/notifications.md`
