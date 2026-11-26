# Split

8 dev cases (for tuning guidance) and 12 held-out cases (for the final score). Every kind appears in both halves; the held-out half covers all ten failure classes, the dev half covers eight of them (file import/export and input bounds have one dev case each, idempotency and performance are held-out only).

## Dev (8)

| Case | Kind | Class |
|---|---|---|
| f01-stock-oversell | fix | concurrency on shared rows |
| f03-tenant-leak | fix | multi-tenant isolation |
| f07-customer-csv-arabic | fix | file import/export with Arabic text |
| b09-partial-refunds | build | money and rounding |
| b10-password-reset | build | auth and session misuse |
| b12-product-search | build | input bounds and validation |
| b13-sms-confirmation | build | outbound provider call |
| m17-phone-backfill | feature | live schema change and backfill |

## Held-out (12)

| Case | Kind | Class |
|---|---|---|
| f02-invoice-rounding | fix | money and rounding |
| f04-session-revocation | fix | auth and session misuse |
| f05-webhook-double-credit | fix | idempotency for retries and webhooks |
| f06-orders-list-slow | fix | performance at 100x data |
| b08-coupon-redemption | build | concurrency on shared rows |
| b11-idempotency-keys | build | idempotency for retries and webhooks |
| b14-customer-report | build | performance at 100x data |
| b15-product-import | build | file import/export with Arabic text |
| m16-tenant-api-keys | feature | multi-tenant isolation |
| m18-order-numbers | feature | live schema change and backfill (plus concurrency) |
| m19-card-checkout | feature | outbound provider call (plus idempotency) |
| m20-order-edit-bounds | feature | input bounds and validation |

Kinds: dev 3 fix / 4 build / 1 feature; held-out 4 fix / 4 build / 4 feature. Totals: 7 fix, 8 build, 5 feature.
