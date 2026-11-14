# Long tasks — a checkbox plan in `.agents/plans/`

A task that will take more than one session, or has three or more phases, gets an execution plan before the work starts:

    kit_plans.py new "<title>" --goal "…" --phase "<name> :: <acceptance>" [--phase …]

The script is in the kit's `hooks/` folder and creates `.agents/plans/<slug>/plan.md`. `Plan/` stays for documents the owner reads; this file is the working tracker.

- Each phase has an acceptance line and `- [ ]` tasks small enough to finish and verify one at a time.
- Tick a box when its task is done **and verified**, in the same turn. Add steps you discover; record decisions and blockers under `## Notes`.
- The session brief names the active plan and its next item: read the plan and continue from there, don't re-explore finished work.
- Nothing left → `Status: done`. Owner parks it → `Status: paused`.
- `kit_plans.py status` lists the plans and which one is active.

## Lessons

`lessons.py add --when … --wrong … --right … [--files globs] [--commands text] [--global]` (same folder). Lessons live in `.agents/memory/lessons.md` (committed); owner-wide ones in `~/.agents/lessons.md`. Scope a lesson to the files or commands it is about; leave it general only when it always applies; `--global` only for an owner preference that holds in every project. One specific sentence per field.
