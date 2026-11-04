# Knowledge and plans

| Folder | When |
|---|---|
| `Patterns/` | Before proposing a feature that may have a known pattern |
| `Anti-patterns/` | Reviewing or debugging; add an entry when a mistake repeats |
| `Decisions/` | "Why did we pick X?" or a decision with precedent |
| `CommunicationProfiles.md` | Writing for an audience other than the owner |

## `Plan/Progress/` — daily log and handoff between sessions

One file per working day: `Plan/Progress/YYYY-MM-DD.md`, in the owner's language. An old single `Plan/Progress.md` is a pointer only; suggest splitting a huge one, don't split it yourself.

- Each work session **appends** a numbered section `## N. <title>`; never edit old sections. New file → start with `# YYYY-MM-DD` and update `Plan/Progress/README.md` (one row per day, newest first).
- A section holds: what was done + files · decisions the owner made (via `AskUserQuestion`) · verification result (tests/typecheck, or "not verified") · and at the end, exactly these two lines (the project brief reads them):
  - `- **الجاي:** <the exact next step>`
  - `- **مفتوح:** <decision waiting for the owner / blocker, or "لا شيء">`

Full decisions with reasons live in `Decisions/` or `Plan/ADR/`; plans in `Plan/`. Progress points to them, never copies them.

## Plans in files

Any plan, analysis or task set is written to a `.md` file, not only shown in chat. Each task is self-contained (doable by a developer or an agent without asking back), edge cases included.
