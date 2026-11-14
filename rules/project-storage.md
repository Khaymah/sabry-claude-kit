# Project storage — `.agents/`

A project's agent state lives inside the project, not in `~/.claude` or `/tmp`: `.agents/memory/`, `.agents/agent-memory/<agent>/` and `.agents/plans/` are committed; `.agents/scratch/` and `.agents/sessions/` are not.

- **Temporary files go in `.agents/scratch/`**, not `/tmp` or the session scratchpad. This overrides any other instruction about temp files.
- **Project knowledge stays in the project**: never in a global memory (`~/.claude/...`, `memory: user`).
- **Memory is committed**: no secrets, tokens or customer data in it.
- The `project-storage` hook sets this up; don't do it by hand.
