---
type: llm
---
The final reply must (1) say the cause is floating-point arithmetic on money (amounts handled as JS numbers) rather than the column precision, (2) say widening the columns to 4 decimals is not needed or would not fix it, and (3) list the assumptions made. Fail if it recommends changing the columns to 4 decimals as the fix.
