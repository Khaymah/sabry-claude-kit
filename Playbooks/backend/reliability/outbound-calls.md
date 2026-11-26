# Integrating a third-party API (and its webhooks)

- **Situation:** connecting a payment gateway (Paymob, Fawry, Stripe), SMS or WhatsApp provider, shipping company, ERP, maps, LLM API; receiving their webhooks; "the provider changed their response and we broke".
- **Skip when:** an official SDK already covers everything below (still wrap it in an adapter).
- **Decision:** each provider lives in one adapter behind a port (`quality/maintainability/solid-pragmatic.md`). Outbound calls go through the shared `OutboundFetch` (timeouts, retries, logging: `quality/reliability/timeouts-retries.md`); responses are validated with Zod before use; credentials and mode (sandbox/live) come from `SystemSettings`. Incoming webhooks are verified on the raw body, recorded, answered fast and processed in a job.

## Levels

| Level | Pick when |
|---|---|
| Minimum | One provider, low volume |
| Standard | Production, money or messaging providers |
| Advanced | Several providers per capability, failover, reconciliation |

## Rules

### Minimum — always, never cut

- One folder per provider (`Adapters/Paymob/`): client, types, mappers, webhook verifier. Nothing else in the codebase imports the provider's SDK or URLs.
- Credentials from `SystemSettings` secrets; never in code or env beyond bootstrap.
- Every call has a timeout; non-idempotent calls carry the provider's idempotency key or are never retried.
- Webhooks: verify the signature (HMAC or the provider's scheme) over the **raw** body before parsing; reject on mismatch with `401`, logging only the event id.
- Never trust webhook data alone for money: re-fetch the transaction from the provider's API or compare amount and currency with our order (`backend/data/money.md`).

### Standard — adds

- Responses parsed with a Zod schema; unexpected shapes become `PROVIDER_BAD_RESPONSE` with the raw body logged (redacted), not a crash deep in our code.
- Provider errors mapped to our codes at the adapter boundary (`PAYMENT_DECLINED`, `PROVIDER_UNAVAILABLE`).
- Webhook handler: verify → insert `ProcessedWebhooks(Provider, EventId)` (unique) → enqueue a job with the event id → `200` within a second. Duplicates answer `200` and stop.
- Store provider references (`ProviderRef`) and the raw request/response of money calls in an append-only `ProviderCalls` table for disputes (secrets and card data redacted).
- Sandbox and live are separate settings sets; the active mode is visible in the admin and in logs.
- Contract test per adapter against recorded fixtures of real responses.

### Advanced — adds

- Failover between providers of the same capability (SMS A → SMS B) through the port.
- A daily reconciliation job compares our records with the provider's report.
- Webhook IP allow-list where the provider publishes ranges, in addition to signatures.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Webhook arrives before our redirect returns the user | The job processes it; the success page polls the order status |
| Webhook never arrives | A job queries the provider for orders pending payment older than N minutes |
| Provider sends amounts in major units as strings | Converted in the adapter (`backend/data/money.md`); the core sees minor units |
| Provider adds new fields or enum values | Schemas use `.passthrough()` where harmless; unknown enum values mapped to an `Unknown` state and alerted |
| Signature uses specific field order (Paymob HMAC) | Implemented exactly per the provider docs, with a test using a documented sample payload |
| 100×: webhook bursts | Handler only records and enqueues; processing concurrency bounded |
| Twice / parallel: the same webhook twice, in parallel | `ProcessedWebhooks` unique constraint: processed once |

## Example — Standard, Bun + Hono

```ts
WebhooksRoutes.post("/stripe", async (c) => {
  const Raw = await c.req.text()
  const Signature = c.req.header("Stripe-Signature") ?? ""
  const Event = await VerifyStripeEvent(Raw, Signature, GetSetting("Payments.Stripe.WebhookSecret"))
  if (!Event) throw new AppError("WEBHOOK_SIGNATURE_INVALID", 401)
  const [Recorded] = await db.insert(ProcessedWebhooks)
    .values({ Provider: "Stripe", EventId: Event.id, Type: Event.type })
    .onConflictDoNothing()
    .returning({ Id: ProcessedWebhooks.Id })
  if (Recorded) await Boss.send("Payments.StripeEvent", { EventId: Event.id }, { singletonKey: `stripe:${Event.id}` })
  return c.json({ Received: true })
})

const PaymobTransaction = z.object({
  id: z.number(),
  success: z.boolean(),
  amount_cents: z.number().int(),
  currency: z.string().length(3),
  order: z.object({ merchant_order_id: z.string() }),
}).passthrough()
```

The webhook route is mounted before any body-parsing middleware so the raw body is intact. `VerifyStripeEvent` wraps `stripe.webhooks.constructEventAsync` (which also checks the timestamp tolerance); the job re-reads the event from the provider before changing an order.

## Verify

- [ ] `[M]` A webhook with a modified body fails signature verification.
- [ ] `[M]` `grep -rn "api.paymob\|api.stripe\|fawry" Src/` hits only adapter folders.
- [ ] `[S]` The same webhook delivered three times produces one job.
- [ ] `[S]` A malformed provider response returns `PROVIDER_BAD_RESPONSE`, not a 500 crash.
- [ ] `[S]` Contract tests pass on recorded fixtures.
- [ ] `[A]` Reconciliation job reports zero differences on a test day.

## Pitfalls

- **Parsing JSON before verifying the signature** → re-serialised body fails or, worse, unsigned data is trusted → raw body first.
- **Marking orders paid from the redirect URL** → anyone can fake it → only verified webhooks or API checks.
- **Provider SDK calls scattered in services** → switching or mocking is impossible → one adapter.

## Related

`quality/reliability/timeouts-retries.md` · `backend/reliability/idempotency.md` · `backend/reliability/background-jobs.md` · `backend/data/money.md`
