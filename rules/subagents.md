# Subagents — model from the frontmatter

- **Kit agents:** the model comes from each agent's frontmatter. **Don't pass `model`.** Built-in agents (`Explore` · `general-purpose` · `Plan`): pass `model: "sonnet"` unless the task needs more; never `haiku`.
- A subagent rebuilds its context, so **the cost doubles**. ✅ Delegate independent tracks, several viewpoints on one thing, wide scans, reviews that need a clean context. ❌ Not a few tool calls, dependent sequential steps, fewer than ~3 files, or verifying your own work.
- Parallel calls go in **one message**. Brief once and commit to the result.
- **Every brief has:** goal and definition of done · what is known and ruled out · bounds (read-only? which files?) · report shape and length. Template: `Reference/subagent-briefing.md`.
