# PayFast webhooks (copied from the provider's docs)

- Endpoint we registered: `POST /Webhooks/Payments`.
- Each event has a unique `EventId`. The body is signed: `X-Signature` = hex HMAC-SHA256 of the raw body with the webhook secret (`PaymentProvider.WebhookSecret` in `SystemSettings`).
- Delivery is at-least-once. Any response other than 2xx is retried with backoff for up to 3 days, and the same event may be delivered more than once, sometimes in parallel. `X-Delivery-Attempt` counts the attempts.
- Retries may re-serialize the JSON (whitespace can differ); the signature always matches the body as sent.
