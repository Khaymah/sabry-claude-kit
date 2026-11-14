---
type: llm
---
PASS if the final reply accounts for all three asks separately (createCoupon validation, applyCoupon expiry and floor at zero, redeem limit under 20 concurrent requests), names the mechanism that makes redeem safe under concurrency (for example a per-coupon lock or queue, or an atomic check-and-increment in the store), and reports the test run with its actual result.
FAIL if any ask is missing, if the concurrency fix is described only as "checks the limit before incrementing", or if it claims tests pass without having run them.
