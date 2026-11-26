# ESLint preset — the traps that need a type checker

`hooks/enforce-code-traps.py` catches traps by pattern while the agent writes. This preset catches the ones that need real parsing and types, in the editor and in CI, for anyone who touches the code.

| Rule | Catches | Playbook |
|---|---|---|
| `drizzle/enforce-update-with-where` · `enforce-delete-with-where` | `update` / `delete` with no `.where()` | `Stacks/Database.md` §4 |
| `no-await-in-loop` | N+1 and serial round trips | `quality/performance/query-performance.md` |
| `@typescript-eslint/no-floating-promises` · `no-misused-promises` | Promises nobody awaits, `forEach(async)` | `quality/TRAPS.md` §Async |
| `regexp/no-super-linear-backtracking` (+ regexp recommended) | ReDoS | `quality/performance/event-loop-cpu.md` |
| `no-restricted-syntax` | `forEach(async)`, sync I/O and crypto, `select()` of every column, `parseFloat` | `quality/TRAPS.md` |
| `no-empty` · `no-console` · `only-throw-error` | Swallowed errors, console logging, throwing strings | `quality/observability/logging.md` |
| `@typescript-eslint/switch-exhaustiveness-check` | A new enum value silently unhandled | `quality/maintainability/complexity-limits.md` |
| `max-lines` 600 · `max-depth` 3 · `max-params` 4 · `complexity` 10 | Complexity limits | `quality/maintainability/complexity-limits.md` |

Tests, scripts and seeds are relaxed; migrations and generated files are ignored.

## Install (Bun + TypeScript project)

```bash
bun add -d eslint@9 typescript-eslint@8 eslint-plugin-regexp@2 eslint-plugin-drizzle
```

```bash
cp <kit>/Templates/eslint/eslint.config.mjs ./eslint.config.mjs
```

```json
{ "scripts": { "lint": "eslint ." } }
```

Without Drizzle: remove the `drizzle` import, plugin and its two rules. Next.js: keep the project's `next` config entries and append this file's objects to the same array.

## Accepted exceptions

A loop over fixed chunks or keyset batches is the right way to batch. Mark it with a directive, which the comment rule allows:

```ts
for (let I = 0; I < Rows.length; I += CHUNK) {
  // eslint-disable-next-line no-await-in-loop -- one bulk statement per chunk
  await db.insert(Products).values(Rows.slice(I, I + CHUNK))
}
```

Never disable a rule for a whole file to make CI green.

## Verified

The preset was run against a file containing every trap above (14 findings, all caught) and against the corrected version (0 findings) with eslint 9.39, typescript-eslint 8.74, eslint-plugin-regexp 2.10 and eslint-plugin-drizzle 0.2.3.
