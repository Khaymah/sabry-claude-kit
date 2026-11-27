# SMS in Egypt

- **Situation:** send SMS to Egyptian (and some Gulf) numbers, order and delivery alerts, OTP delivery, "الرسالة مش بتوصل", "فاتورة SMS عالية", Arabic text, sender name.
- **Skip when:** WhatsApp or push already covers the message and SMS is not required (see `domains/messaging/whatsapp.md`, `domains/messaging/push.md`).
- **Decision:** numbers are normalised to E.164 before any lookup, limit or send; SMS goes through a provider adapter with a second provider as failover; every send is rate limited per number and per IP and counted against a daily budget; delivery reports update the row. Provider names, limits and sender ID are defaults when the project has none; the owner's rules win. OTP rules live in `backend/auth/otp.md`; this file covers the transport.

## Levels

| Level | Pick when |
|---|---|
| Minimum | A few alert SMS, one provider |
| Standard | Production OTP or alerts: limits, budget, delivery reports, Arabic handling |
| Advanced | Two providers with failover, per-route cost reporting, per-tenant sender IDs |

## Rules

### Minimum — always, never cut

- Normalise with `libphonenumber-js` to E.164 at the edge, region `EG`. Egyptian mobile is `+20` then `10`, `11`, `12` or `15` then 8 digits; accept `01012345678`, `1012345678`, `+201012345678`, `00201012345678` and Arabic-Indic digits, store `+201012345678`. Anything that is not a valid mobile is a 400.
- Unique key and every limit use the E.164 form, never the raw input; `0101…` and `+20101…` are the same number.
- Send from a job (`backend/reliability/background-jobs.md`) with a dedupe key; never inside the request.
- Per-number limit (for example 5 per hour) and per-IP limit (for example 20 per hour) before the job is enqueued (`backend/reliability/rate-limit.md`). The response is identical for allowed and limited numbers where it would reveal account existence.
- Daily and monthly spend caps in `SystemSettings`; at 80% alert, at 100% stop non-critical sends.
- Provider key from config; never log the message body for OTP.

### Standard — adds

- Country allow-list; numbers outside it are rejected before sending (SMS pumping, `backend/auth/otp.md`).
- Provider adapter `SendSms(To, Text, SenderId)`; delivery report webhook verified by signature, upserted by provider message id, status moves only forward (`Queued` → `Sent` → `Delivered` or `Failed`).
- Encoding: pure GSM-7 text is 160 chars per segment (153 when multipart). Any Arabic character forces UCS-2: 70 chars per segment (67 multipart), so a 150-char Arabic message is 3 billed segments. Count segments before sending, show the cost, and keep OTP and alert texts under one UCS-2 segment (70 chars).
- Sender ID: Egyptian operators require a registered alphanumeric sender (max 11 chars, Latin letters and digits) per brand; registration takes days and is per operator. An unregistered sender is rewritten or blocked, so keep the sender in config and a numeric fallback.
- Opt-out for marketing: a STOP keyword or link, stored suppression; transactional SMS ignores it.
- Do not send between 22:00 and 08:00 Cairo for non-urgent categories (`backend/data/time-zones.md`).

### Advanced — adds

- Failover: on provider 5xx, timeout or an unroutable status, retry once through the second provider with the same DedupeKey; record which provider delivered. Never fail over on a "delivered" or on an ambiguous timeout without checking the first provider's report window, or the user gets two messages.
- Per-operator delivery rates (Vodafone, Orange, Etisalat, WE); alert when one drops below the threshold and reroute.
- Cost per message stored from the report, reconciled monthly against the invoice.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Input `"٠١٠١٢٣٤٥٦٧٨"` or `" 010 1234 5678 "` | Digits mapped, spaces removed, stored as `+201012345678` |
| Landline `02…` or a 9-digit mobile | 400 "mobile number required"; never sent |
| Same number typed three ways | One normalised value; one rate-limit bucket |
| Attacker rotates numbers from one IP | Per-IP limit and country allow-list stop it; budget alert fires |
| Message mixes Arabic and one emoji | UCS-2; emoji can take two code units, so segment count is computed on UTF-16 length |
| Smart quotes or Arabic comma in a "Latin" text | Forces UCS-2 and triples the cost; normalise punctuation in English templates |
| Report says `Failed` after the provider said accepted | Row updates to `Failed`; the notification layer may fall back to another channel once |
| Number recycled to a new owner | Treat a phone as unverified again after a long inactivity or after a hard failure report |
| Provider timeout (unknown outcome) | Retry only with the provider's idempotency key; otherwise wait for the report before resending |
| Data at 100×: 10M SMS rows | Partition by month, index `(ProviderMessageId)` and `(To, CreatedAt)`; store the text by template id plus variables |
| Twice / parallel: the user taps "resend" twice | The 60 s cooldown and the dedupe key make the second a no-op that returns the same response |

## Example — Standard, Bun + Hono + Drizzle

```ts
import { parsePhoneNumberFromString } from "libphonenumber-js"

const ARABIC_DIGITS = /[٠-٩]/g

export function NormalizeEgyptPhone(Input: string): string {
  const Clean = Input.trim().replace(ARABIC_DIGITS, (D) => String(D.charCodeAt(0) - 0x0660)).replace(/[\s-]/g, "")
  const Phone = parsePhoneNumberFromString(Clean, "EG")
  if (!Phone || !Phone.isValid() || Phone.getType() !== "MOBILE") throw new AppError("PHONE_INVALID", 400)
  return Phone.number
}

export function CountSegments(Text: string): { Encoding: "GSM7" | "UCS2"; Segments: number } {
  const IsGsm = /^[\x20-\x7E\n]*$/.test(Text)
  const Length = Text.length
  const Single = IsGsm ? 160 : 70
  const Multi = IsGsm ? 153 : 67
  return { Encoding: IsGsm ? "GSM7" : "UCS2", Segments: Length <= Single ? 1 : Math.ceil(Length / Multi) }
}

export async function QueueSms(To: string, Template: string, Variables: Record<string, string>, Ip: string) {
  const Number = NormalizeEgyptPhone(To)
  await EnforceLimits({ Number, Ip })
  await EnforceBudget()
  const Text = RenderSmsTemplate(Template, Variables)
  const Cost = CountSegments(Text)
  const DedupeKey = `${Template}:${Number}:${Variables.Reference ?? ""}`
  const [Row] = await Db.insert(SmsSends).values({ To: Number, Text, Segments: Cost.Segments, DedupeKey }).onConflictDoNothing().returning()
  if (Row) await Boss.send("SendSms", { SendId: Row.Id }, { singletonKey: Row.Id })
}
```

`String.length` counts UTF-16 units, which matches how UCS-2 segments are billed.

## Verify

- [ ] `[M]` All four Egyptian formats and Arabic-Indic digits normalise to the same `+20…` string; a landline is rejected.
- [ ] `[M]` The sixth request for one number in an hour is blocked before a job exists.
- [ ] `[M]` Setting the daily cap to 0 stops sends and raises an alert.
- [ ] `[S]` A 71-character Arabic text counts as 2 segments; 70 characters counts as 1.
- [ ] `[S]` A replayed delivery report does not move a `Delivered` row back to `Sent`.
- [ ] `[A]` Primary provider mock returning 503 sends once through the second, never twice.

## Pitfalls

- **Rate limiting on the raw string** → `010…` and `+2010…` get separate buckets → limit on E.164.
- **Assuming 160 chars for Arabic** → bill three times the estimate → count UCS-2.
- **Hard-coding a sender ID that is not registered** → silently replaced or dropped → config plus fallback.
- **Retrying on a timeout without an idempotency key** → duplicate message and cost → wait for the report.
- **Sending OTP in quiet-hours rules** → blocked code → urgent categories bypass quiet hours.

## Related

`backend/auth/otp.md` · `backend/reliability/rate-limit.md` · `backend/reliability/background-jobs.md` · `backend/reliability/outbound-calls.md` · `backend/data/time-zones.md` · `domains/messaging/notifications.md`
