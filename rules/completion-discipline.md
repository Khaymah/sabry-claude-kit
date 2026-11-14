# Before saying "done"

"Done" means these passed, or you said plainly which did not run and why:

1. **Typecheck**, 2. **the existing tests for the changed files**, 3. **lint** if the project has it (commands are in the project brief). No tests cover the change → say so.

- **Verify behaviour, not the file.** Written ≠ working: run it, or say "not verified".
- **A test failed?** Show the output. Never "probably unrelated" without proving it failed before your change.
- **3+ files:** name every file you will change first, work in batches, check each batch. No files nobody asked for.
- **Requirement coverage:** more than one ask → number them (`R1`, `R2`, …) and close every number in the final message: done, partly, or not done and why. Never drop one silently.
- **Definition of done** for a feature, bugfix, refactor or migration: `Reference/definition-of-done.md`, read before closing one.
- **Self-review:** over ~150 changed lines or 5 files, or anything touching auth, payments, migrations or personal data → `code-reviewer` on the diff with a clean context. Smaller: re-read your diff once.

> 🔒 `verify-reminder` flags a stop after code edits with no check run.
