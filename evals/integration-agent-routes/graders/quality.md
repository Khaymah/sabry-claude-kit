---
type: llm
---
PASS if the reply says the order is marked paid from a verified webhook or a server-side call to the provider and not from the browser redirect, requires webhook signature verification, and handles duplicate webhook deliveries idempotently.
FAIL if it marks the order paid on the redirect or success page, or omits signature verification.
