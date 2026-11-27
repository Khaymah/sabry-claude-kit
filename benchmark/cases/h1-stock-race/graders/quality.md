---
type: llm
focus: { source: file, path: src/shop.mjs }
---
PASS if the check and the decrement of stock can no longer interleave between concurrent purchases: for example a per-product lock or queue around the whole read-check-write, or an atomic conditional decrement added to the store and used by purchase. The fix must also cover the order creation step (no order without stock taken, no stock taken without an order or a compensating restore).
FAIL if it only re-checks stock before saving, adds a delay, or relies on a single in-flight flag that drops concurrent buyers silently.
