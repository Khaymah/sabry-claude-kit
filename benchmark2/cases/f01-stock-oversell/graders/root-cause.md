---
type: llm
---
The final reply must (1) say the cause is order creation reading stock and later writing a computed value back (a read-then-write race between simultaneous orders), (2) say plainly that cancellation is not restocking twice, contrary to the owner's guess, and (3) list the assumptions made. Fail if it blames cancellation or proposes only a UI/rate-limit fix.
