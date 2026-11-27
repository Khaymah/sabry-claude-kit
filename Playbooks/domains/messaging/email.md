# Transactional email

- **Situation:** welcome, receipt, invoice, password reset links, "الايميل مش بيوصل", "راح على السبام", Arabic RTL templates, bounces.
- **Skip when:** marketing campaigns and newsletters (use the provider's campaign tool), or only a mailto link.
- **Decision:** send through a provider adapter (`SendEmail(Message)`) from a background job, never inside the request; templates are versioned and render RTL for Arabic; bounce and complaint webhooks write a suppression list that every send checks first. Concrete names and defaults apply when the project has none; the owner's provider and rules win. Validation at the edge and idempotent jobs stay absolute.

## Levels

| Level | Pick when |
|---|---|
| Minimum | A few system emails, one provider |
| Standard | Production: webhooks, suppression, templates in two languages, test mode |
| Advanced | Per-tenant sender domains, dedicated IP, engagement tracking, provider failover |

## Rules

### Minimum — always, never cut

- Enqueue a job with ids (`backend/reliability/background-jobs.md`); the handler loads the data and renders. The HTTP response never waits on the provider.
- Claim before the provider call: `UPDATE "EmailSends" SET "Status" = 'Sending' WHERE "Id" = $1 AND "Status" = 'Pending' RETURNING`; no row back means another worker owns it. A sweeper returns stale `Sending` rows to `Pending`.
- The provider sits behind one adapter interface; the core never imports the provider SDK.
- Reset and verification links carry a hashed, expiring token (`backend/auth/password-reset.md`); never log the full email body or the link.
- Check the recipient against `EmailSuppressions` immediately before sending; a suppressed address is skipped and recorded, not errored.
- Normalise addresses at the edge: trim, lowercase the domain, reject more than one `@`, strip CR/LF (header injection).
- From, Reply-To and provider keys come from config, not from user input.

### Standard — adds

- Send from a subdomain (`mail.example.com`) with SPF, DKIM and DMARC (`p=none` first, then `quarantine` after reports are clean) published; the app checks nothing but the ops checklist must exist.
- Templates are files with a version; render with an HTML-escaping engine; every email has a plain-text part and a localised subject.
- Arabic: `<html lang="ar" dir="rtl">`, a web-safe fallback font (Tahoma, Arial) because many clients drop web fonts, numbers in the locale the owner chose, mixed LTR parts (order numbers, URLs) wrapped in `<bdi>` or `dir="ltr"`. Test in Gmail, Outlook and Apple Mail.
- Webhook endpoint verifies the provider signature on the raw body with a constant-time compare (`timingSafeEqual` after a byte-length check), then upserts by provider event id (idempotent). Hard bounce and spam complaint add the address to `EmailSuppressions`; soft bounces suppress after 3 in a row.
- Store `ProviderMessageId` per send so webhooks update the right row.
- Test mode: a config flag routes every send to a capture sink (log, Mailpit, or the provider's sandbox); production never sends from a non-production environment, and a staging allow-list blocks real customers.

### Advanced — adds

- Failover to a second provider on 5xx or timeout, with the same adapter and the same dedupe key.
- Per-tenant sender identity verified by DNS; the tenant cannot send from a domain it has not verified.
- Complaint-rate and bounce-rate alerts (above 0.1% complaints, pause that stream).

## Edge cases

| Case | Expected behaviour |
|---|---|
| Provider accepts but the recipient server bounces later | The webhook arrives minutes later and suppresses; the send row moves from `Sent` to `Bounced` |
| Address is suppressed, user fixes the typo | A new address is a new row; the old one stays suppressed; a user can request removal only after verifying ownership |
| Subject or name with Arabic or emoji | UTF-8 header encoding by the adapter; never build raw headers by string concatenation |
| User-controlled name `"X\r\nBcc: a@b.com"` | Rejected at the edge; CR/LF stripped before reaching the adapter |
| Reset email requested 10 times | Per-address and per-IP rate limit (`backend/reliability/rate-limit.md`); one active token |
| Provider outage for an hour | Retries with backoff; the user sees "check your email" and a resend after 60 s cooldown |
| Webhook replayed or out of order | Upsert by provider event id; an older status never overwrites a newer one |
| Data at 100×: 5M sends logged | Partition `EmailSends` by month, keep bodies out of the table (template id plus variables), purge after the retention period |
| Twice / parallel: the job runs twice | `DedupeKey` unique on `EmailSends`; the second run sees `Sent` and exits |
| Gmail clips messages over ~102 KB | Keep HTML small; no inline base64 images, host images by URL |

## Example — Standard, Bun + Hono + Drizzle

```ts
export interface EmailAdapter {
  Send(Message: { To: string; Subject: string; Html: string; Text: string; DedupeKey: string }): Promise<{ ProviderMessageId: string }>
}

export async function SendEmailJob(Job: { data: { SendId: string } }) {
  const Send = await Db.query.EmailSends.findFirst({ where: eq(EmailSends.Id, Job.data.SendId) })
  if (!Send || Send.Status !== "Pending") return
  const Suppressed = await Db.query.EmailSuppressions.findFirst({ where: eq(EmailSuppressions.Address, Send.To) })
  if (Suppressed) return Db.update(EmailSends).set({ Status: "Suppressed" }).where(eq(EmailSends.Id, Send.Id))
  const [Claimed] = await Db.update(EmailSends).set({ Status: "Sending" }).where(and(eq(EmailSends.Id, Send.Id), eq(EmailSends.Status, "Pending"))).returning()
  if (!Claimed) return
  const Rendered = RenderTemplate(Send.Template, Send.Locale, Send.Variables)
  const Result = await Adapter.Send({ To: Send.To, Subject: Rendered.Subject, Html: Rendered.Html, Text: Rendered.Text, DedupeKey: Send.DedupeKey })
  await Db.update(EmailSends).set({ Status: "Sent", ProviderMessageId: Result.ProviderMessageId }).where(eq(EmailSends.Id, Send.Id))
}

App.post("/webhooks/email", async (C) => {
  const Raw = await C.req.text()
  if (!VerifySignature(Raw, C.req.header("signature"))) return C.json({ Error: "Invalid signature" }, 401)
  for (const E of ParseEvents(Raw)) {
    await Db.insert(EmailEvents).values(E).onConflictDoNothing()
    if (E.Type === "hard_bounce" || E.Type === "complaint") await Db.insert(EmailSuppressions).values({ Address: E.Address, Reason: E.Type }).onConflictDoNothing()
  }
  return C.json({ Ok: true })
})
```

Other stacks: Laravel Mail with a queued Mailable and a `MessageSending` listener for suppression; same flow.

## Verify

- [ ] `[M]` The request returns before the provider is called (provider mock delayed 5 s, response under 200 ms).
- [ ] `[M]` A suppressed address is never passed to the adapter.
- [ ] `[M]` A name containing `\r\n` is rejected.
- [ ] `[S]` Arabic email renders RTL in Gmail and Outlook; order numbers stay LTR.
- [ ] `[S]` A replayed bounce webhook creates one suppression row; a bad signature gets 401.
- [ ] `[S]` Non-production config sends nothing outside the allow-list.
- [ ] `[A]` Killing the primary provider mock sends through the second without a duplicate.

## Pitfalls

- **Sending inside the request** → slow signup and double emails on retry → job with dedupe key.
- **Verifying the webhook on parsed JSON** → signature never matches or is skipped → verify the raw body.
- **Ignoring complaints** → provider throttles the domain → suppress and alert.
- **Web fonts only for Arabic** → fallback glyphs break joining in some clients → web-safe stack.
- **Sending from the root domain with no DMARC** → spoofable, lands in spam → subdomain with SPF, DKIM, DMARC.

## Related

`backend/reliability/background-jobs.md` · `backend/reliability/idempotency.md` · `backend/auth/password-reset.md` · `backend/reliability/rate-limit.md` · `domains/messaging/notifications.md`
