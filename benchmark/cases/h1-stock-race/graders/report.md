---
type: llm
---
PASS if the final reply names the root cause (read-check-write race between await points), names the mechanism of the fix, and reports the concurrent test with its actual result. It should also say how this maps to a real database (an atomic conditional UPDATE or SELECT FOR UPDATE).
FAIL if it claims the tests pass without having run them, or describes the fix only as "check stock before saving".
