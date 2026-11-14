# `Plan/Progress/` — daily log and handoff between sessions

One file per working day: `Plan/Progress/YYYY-MM-DD.md`, in the owner's language. An old single `Plan/Progress.md` is a pointer only; suggest splitting a huge one, don't split it yourself.

- Each work session **appends** a numbered section `## N. <title>`; never edit old sections. New file → start with `# YYYY-MM-DD` and update `Plan/Progress/README.md` (one row per day, newest first).
- A section holds: what was done + files · decisions the owner made (via `AskUserQuestion`) · verification result (tests/typecheck, or "not verified") · and at the end, exactly these two lines (the project brief reads them):
  - `- **الجاي:** <the exact next step>`
  - `- **مفتوح:** <decision waiting for the owner / blocker, or "لا شيء">`

Test: if the context were wiped now, could the next session continue from this file alone? Quick questions with no work done: skip it.

Full decisions with reasons live in `Decisions/` or `Plan/ADR/`; plans in `Plan/`. Progress points to them, never copies them.
