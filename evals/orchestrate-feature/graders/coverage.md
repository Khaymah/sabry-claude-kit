---
type: llm
---
PASS if the final reply accounts for all three asks separately (admin creates a coupon, customer applies it at checkout, usage limit holds under concurrent orders), states for each whether it is covered, and addresses the concurrency ask with a concrete mechanism (transaction with row lock, atomic conditional update, or unique constraint).
FAIL if any of the three asks is missing from the final reply, or the concurrency ask is answered only with "check the count before applying".
