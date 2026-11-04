# Before saying "done"

**Typecheck catches types, not logic.** "Done" means these passed, or you said plainly which one did not run and why:

1. **Typecheck (TS):** the project's script (see the project brief), else `bunx tsc --noEmit --skipLibCheck`.
2. **Existing tests for the changed files** — not the whole suite if it is heavy (`bun test <path>` · `bunx vitest run <path>` · the `package.json` script). No tests cover the change → say so; don't write tests unasked.
3. **Lint if the project has it** — on the changed files only.

- **3+ files:** work in batches; typecheck + tests per batch before continuing. Don't pile up errors.
- **A test failed?** Show the output as is. Never "probably unrelated" without proving it failed before your change too.
- **Verify behaviour, not the file.** A hook/config/endpoint that was written ≠ working. Run it; if you can't, say "not verified".
- **Scope:** for 3+ files, name every file you will change before starting. Found another file that needs changing → say so first. Don't add files nobody asked for.

> 🔒 `verify-reminder` flags a stop after code edits with no check run.
