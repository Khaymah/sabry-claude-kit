---
type: llm
---
The final reply must (1) say the slowness comes from per-order queries (N+1) and loading all rows to count, not something a cache should hide, (2) say the duplicate/missing orders come from ordering by a non-unique column without a tie-breaker, not from new orders arriving, and (3) list the assumptions made.
