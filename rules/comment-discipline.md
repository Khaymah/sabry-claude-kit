# Comment discipline — iron rule

**Code carries no comments.** No line comments, no block comments, **no JSDoc.** Only exception: a comment starting with `IMPORTANT:` marking something truly critical.

- Readable code is never commented. Rationale (the why, design decisions) goes in `Plan/ADR/` and `Plan/`, never in code.
- Don't write comments by default. Touching an old file with comments → remove them.

**Always allowed** (functional, removing them breaks the build): `ts-expect-error` · `ts-ignore` · `ts-nocheck` · `ts-check` · triple-slash `<reference>` · `eslint-*` · `prettier-ignore` · `biome-ignore` · `c8/v8/istanbul ignore` · `@jsxImportSource` · `@vite-ignore` · `webpackChunkName` · `__PURE__` · `@preserve` · `@license` · `/* global */`.

> 🔒 `enforce-comment-discipline` rejects any added comment in JS/TS (non-code files are unaffected).
