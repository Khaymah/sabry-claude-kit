# Before saying "done"

**Typecheck catches types, not logic.** "Done" means these passed, or you said plainly which one did not run and why:

1. **Typecheck (TS):** the project's script (see the project brief), else `bunx tsc --noEmit --skipLibCheck`.
2. **Existing tests for the changed files** — not the whole suite if it is heavy (`bun test <path>` · `bunx vitest run <path>` · the `package.json` script). No tests cover the change → say so; don't write tests unasked.
3. **Lint if the project has it** — on the changed files only.

- **3+ files:** work in batches; typecheck + tests per batch before continuing. Don't pile up errors.
- **A test failed?** Show the output as is. Never "probably unrelated" without proving it failed before your change too.
- **Verify behaviour, not the file.** A hook/config/endpoint that was written ≠ working. Run it; if you can't, say "not verified".
- **Scope:** for 3+ files, name every file you will change before starting. Found another file that needs changing → say so first. Don't add files nobody asked for.

## Requirement coverage

A request with more than one ask: number the asks (`R1`, `R2`, …) before starting. The final message lists every number as done, partly done, or not done with the reason. An ask silently dropped is the worst outcome; "not done, because …" is fine.

## Definition of done by task type

| Type | Also true before "done" |
|---|---|
| **Feature** | The four states exist (empty · loading · error · success) · input validated at the boundary · authorization checked server-side · a test for the main path and one failure path |
| **Bugfix** | Root cause named, not the symptom · a test that failed before the fix and passes after · the same mistake searched for elsewhere in the codebase |
| **Refactor** | Behaviour unchanged: the same tests pass with no edits to their assertions · no drive-by changes outside the stated scope |
| **Migration** | Runs on a copy of real data shape · rollback written and tried, or expand → migrate → contract · old code works on the new schema during deploy |

## Self-review

Over ~150 changed lines or 5 files, or anything touching auth, payments, migrations or personal data: before "done", `code-reviewer` reviews the diff with a clean context (the diff and the request only, not your reasoning). Smaller changes: re-read your own diff once.

> 🔒 `verify-reminder` flags a stop after code edits with no check run.
