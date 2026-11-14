# Comment discipline — iron rule

**Code carries no comments.** No line comments, no block comments, **no JSDoc.** Only exception: a comment starting with `IMPORTANT:` for something truly critical. Rationale goes in `Plan/` and `Plan/ADR/`. Touching an old file with comments → remove them.

Functional directives stay (`ts-expect-error`, `ts-ignore`, `eslint-*`, `prettier-ignore`, `biome-ignore`, coverage ignores, `@license`, triple-slash references and the like).

> 🔒 `enforce-comment-discipline` rejects any added comment in JS/TS.
