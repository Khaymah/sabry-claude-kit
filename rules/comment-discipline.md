# Comment discipline — iron rule

**Code carries no comments.** No line comments, no block comments, **no JSDoc.** Rationale goes in `Plan/` and `Plan/ADR/`. Touching an old file with comments → remove them.

Two exceptions:
- `IMPORTANT: <reason>` for something truly critical.
- `shortcut: <the limit>, <when to upgrade>` for a deliberate shortcut with a known limit (`// shortcut: in-memory rate limit, move to Redis past one server`). `/sabry-kit:kit-debt` collects them, so "later" does not become "never".

Functional directives stay (`ts-expect-error`, `ts-ignore`, `eslint-*`, `prettier-ignore`, `biome-ignore`, coverage ignores, `@license`, triple-slash references and the like).

> 🔒 `enforce-comment-discipline` rejects any other added comment in JS/TS.
