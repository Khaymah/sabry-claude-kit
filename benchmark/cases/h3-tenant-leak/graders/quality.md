---
type: llm
focus: { source: file, path: src/projects.mjs }
---
PASS if getProject, renameProject and deleteProject all scope the database call itself by the user's tenantId (the where condition includes tenantId, so another tenant's row is never read or changed), and a project of another tenant results in the same NotFound as a missing one (not a distinct Forbidden that confirms it exists).
FAIL if any function still reads, updates or deletes by id alone, or if the tenant check happens only after loading or changing the row.
