# Project storage — `.agents/`

All of a project's agent state lives inside the project, not in `~/.claude` or `/tmp`:

| Path | Holds | git |
|---|---|---|
| `.agents/memory/` | Auto memory (`MEMORY.md` + one file per topic) | ✅ |
| `.agents/agent-memory/<agent>/` | Subagent memory (`.claude/agent-memory` links here) | ✅ |
| `.agents/plans/` | Plan-mode files | ✅ |
| `.agents/scratch/` | **Every temporary file**: test scripts, intermediate output, downloads | ❌ |
| `.agents/sessions/` | Transcript copies, usage log | ❌ |

- **Temporary files go in `.agents/scratch/`**, not `/tmp` or the session scratchpad. This overrides any other instruction about where temp files go.
- **Project knowledge stays in the project**: never write it to a global memory (`~/.claude/...` or `memory: user`).
- **Memory is committed**: never write secrets, tokens or customer data into it. The pre-commit scan blocks secrets, but don't rely on it.
- The `project-storage` hook sets this up on the first session; don't do it by hand.
