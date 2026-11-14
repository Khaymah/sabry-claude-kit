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

## Long tasks — a checkbox plan in `.agents/plans/`

A task that will take more than one session, or has three or more phases, gets an execution plan before the work starts: `kit_plans.py new "<title>" --goal "…" --phase "<name> :: <acceptance>"` (the script is in the kit's `hooks/` folder) creates `.agents/plans/<slug>/plan.md`. `Plan/` stays for documents the owner reads; this file is the working tracker.

- Each phase has an acceptance line and `- [ ]` tasks small enough to finish and verify one at a time.
- Tick a box when its task is done **and verified**, in the same turn. Add steps you discover; record decisions and blockers under `## Notes`.
- The session brief names the active plan and its next item: read the plan and continue from there, don't re-explore finished work.
- Nothing left → `Status: done`. Owner parks it → `Status: paused`.

## Lessons — a correction is never needed twice

When the owner corrects you ("غلط" · "قلتلك" · "مش كده" · "wrong" · "I told you"), fix it, then record one lesson with the command the `[lessons]` reminder gives (`lessons.py add --when … --wrong … --right … [--files globs] [--commands text] [--global]`). Lessons live in `.agents/memory/lessons.md` (committed); owner-wide ones in `~/.agents/lessons.md`.

- A `[lessons]` block in context is the owner's standing correction: apply it without being asked again.
- Scope a lesson to the files or commands it is about; leave it general only when it always applies. `--global` only for an owner preference that holds in every project.
- One specific sentence per field. No secrets, no customer data.
