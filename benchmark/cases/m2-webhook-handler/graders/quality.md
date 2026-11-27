---
type: llm
focus: { source: file, path: src/webhook.mjs }
---
PASS if the handler verifies the HMAC over the raw body before parsing or trusting it, compares signatures in constant time, rejects a bad or missing signature with 401, checks the amount and currency against the stored order before marking it paid, and makes a repeated or parallel delivery of the same eventId harmless (recorded once, still answered with 2xx).
FAIL if the JSON is parsed and trusted before verification, the signature is compared with === / !==, the amount is not checked, or duplicates are processed twice.
