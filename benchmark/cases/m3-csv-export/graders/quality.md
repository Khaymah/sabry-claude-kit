---
type: llm
focus: { source: file, path: src/export.mjs }
---
PASS if the export reads orders in bounded batches (limit + afterId keyset) instead of one query for all rows, writes each batch as it goes, escapes CSV correctly (quotes, commas, newlines), prefixes cells that start with = + - @ to stop formula injection, and writes a UTF-8 BOM so Excel shows Arabic.
FAIL if it loads every order in one query or builds the whole file in memory, or misses both the BOM and the formula-injection guard.
