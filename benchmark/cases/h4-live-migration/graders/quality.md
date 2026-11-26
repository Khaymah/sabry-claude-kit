---
type: llm
---
PASS if the plan uses expand → migrate → contract across separate deploys (add the new nullable column, dual-write, backfill in small batches outside the migration, switch reads, drop the old column later), creates the index CONCURRENTLY outside a transaction, sets lock_timeout/statement_timeout, avoids a table rewrite (no ALTER COLUMN TYPE on the live column), converts with exact rounding into integer minor units, and has a verification and rollback step for each phase.
FAIL if it alters the column type in place, backfills the whole table in one statement, or creates the index without CONCURRENTLY.
