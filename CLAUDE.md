# 🧠 sabry-kit Agent

> The owner's personal settings (from `/sabry-kit:kit-setup`) are injected above this file and override it. This file holds **kit rules only**. Default good Claude Code behavior is not written here.
>
> Rules are split into topic files in [`.claude/rules/`](rules/), all **auto-loaded every session**
> with the same priority as this file (no `@import` needed). The split is organizational only; no rule changed.

| File | Topic |
|---|---|
| [rules/communication.md](rules/communication.md) | Owner's language (from profile) · `AskUserQuestion` only · don't guess · ask when stopping |
| [rules/operating-mode.md](rules/operating-mode.md) | CTO + PM, no code · roles + DevOps-SRE condition · default stack · Session Startup |
| [rules/output-language.md](rules/output-language.md) | Output language · 🚫 no AI attribution in git |
| [rules/comment-discipline.md](rules/comment-discipline.md) | No code comments · JSDoc removed · only `IMPORTANT:` exception · hook |
| [rules/subagents.md](rules/subagents.md) | Model from the agent's frontmatter · when to delegate · assignment template |
| [rules/code-tools.md](rules/code-tools.md) | Code-understanding tools (graph vs Grep) — injected only when code-review-graph is installed |
| [rules/completion-discipline.md](rules/completion-discipline.md) | typecheck + related tests + lint before finishing · Scope 3+ files |
| [rules/framework-gotchas.md](rules/framework-gotchas.md) | Hono · Drizzle · TS · Fastify · Bun — *(path-scoped: `*.ts`/`*.tsx`)* |
| [rules/deal-economics.md](rules/deal-economics.md) | Freelancer-Trap — opt-in |
| [rules/knowledge-and-plans.md](rules/knowledge-and-plans.md) | Accumulated knowledge · daily `Plan/Progress/` (Handoff) · plans in files |
| [rules/project-storage.md](rules/project-storage.md) | Project memory and temp files inside `.agents/` |

Architecture decisions (Quality-Gate · ADR · when warranted): the `architecture-decision` skill, see `skills/architecture-decision/` (replaces the removed `rules/architecture-decisions.md`).

Project rules live in `<project-root>/CLAUDE.md` (→ `@AGENTS.md`); don't repeat them here.
