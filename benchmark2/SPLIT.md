# Split

10 dev cases (for tuning guidance) and 15 held-out cases (for the final score). Kinds and failure classes are spread across both halves; the held-out half covers all ten classes.

Prompts state only the owner's need or symptom plus the API contract the tests call (paths, field names, error codes the owner would specify). They do not name the risk the hidden tests check. Fix prompts carry a misleading guess from the owner. The x2* cases ask for two related features at once in a larger codebase (suppliers, purchasing, expenses, audit log, an outdated README), so the risky part is a small slice of the work.

## Dev (10)

| Case | Kind | Class the hidden tests check |
|---|---|---|
| f01-stock-oversell | fix | concurrency on shared rows |
| f03-tenant-leak | fix | multi-tenant isolation |
| f07-customer-csv-arabic | fix | file import/export with Arabic text |
| b09-partial-refunds | build | money and rounding (plus concurrency) |
| b10-password-reset | build | auth and session misuse |
| b12-product-search | build | input bounds and validation |
| b13-sms-confirmation | build | outbound provider call |
| m17-phone-backfill | feature | live schema change and backfill |
| x21-loyalty-wallet | two features | concurrency + money |
| x24-staff-invites | two features | auth and session misuse + tenant isolation |

## Held-out (15)

| Case | Kind | Class the hidden tests check |
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
| x22-supplier-statement | two features | multi-tenant isolation + money + query count |
| x23-expenses-excel | two features | file import/export with Arabic text + money |
| x25-courier-shipping | two features | outbound provider call + idempotent, ordered webhooks |

Kinds: 7 fix, 8 build, 5 feature, 5 two-feature. Dev: 3 fix / 4 build / 1 feature / 2 two-feature. Held-out: 4 fix / 4 build / 4 feature / 3 two-feature.
