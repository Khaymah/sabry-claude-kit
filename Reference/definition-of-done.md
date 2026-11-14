# Definition of done by task type

On top of typecheck, the tests for the changed files and lint:

| Type | Also true before "done" |
|---|---|
| **Feature** | The four states exist (empty · loading · error · success) · input validated at the boundary · authorization checked server-side · a test for the main path and one failure path |
| **Bugfix** | Root cause named, not the symptom · a test that failed before the fix and passes after · the same mistake searched for elsewhere in the codebase |
| **Refactor** | Behaviour unchanged: the same tests pass with no edits to their assertions · no drive-by changes outside the stated scope |
| **Migration** | Runs on a copy of real data shape · rollback written and tried, or expand → migrate → contract · old code works on the new schema during deploy |

Checks, when the project brief does not name them: typecheck `bunx tsc --noEmit --skipLibCheck` · tests for the changed files only when the suite is heavy (`bun test <path>` · `bunx vitest run <path>`) · lint on the changed files. Don't write tests nobody asked for; say when nothing covers the change.
