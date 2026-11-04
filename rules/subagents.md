# Subagents — model from the frontmatter

- **Kit agents** (`agents/*.md`): the model is the `model:` in each agent's frontmatter (all `sonnet` today). **Don't pass `model`** on the call; it overrides the frontmatter.
- **Built-in agents** (`Explore` · `general-purpose` · `Plan`) have no frontmatter here and inherit the session model (opus) without `model`. Pass `model: "sonnet"` explicitly unless the task needs more. Never `haiku`.
- To change an agent's model, edit its `model:` (no hook forces a model; one would override the frontmatter).

## When to delegate

A subagent rebuilds its context, explores, then reports. **The cost doubles.**
- ✅ Delegate: truly independent tracks · several viewpoints on the same thing (security + performance + tests) · wide scans over many files · reviews that need a clean context.
- ❌ Don't: a few tool calls · sequential steps that depend on each other · fewer than ~3 files · verifying your own work (verification stays in the main loop).
- Brief precisely the first time and commit to the result; don't re-derive what the subagent did. Parallel calls go in **one message**.

## Briefing template — better results, fewer tokens

The subagent knows only the prompt, and its whole report lands in the main context:
1. **Goal + definition of done** in two lines.
2. **What is known and ruled out:** files and paths by name, hypotheses already disproved, so it doesn't re-explore them.
3. **Bounds:** read-only or may edit? which files exactly?
4. **Report shape and length:** "a table + ≤ 250 words, paths as `file:line`, no long code".
5. If it needs to understand the project: start from `.agents/memory/MEMORY.md` before reading code.
