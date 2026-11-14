---
type: llm
---
PASS if the reply covers what the user sees offline, a local queue or retry with idempotency so the order is not lost or duplicated, and what survives an app restart.
FAIL if it only says to show an error, or ignores duplicates and restarts.
