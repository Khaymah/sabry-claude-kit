# Briefing a subagent — better results, fewer tokens

The subagent knows only the prompt, and its whole report lands in the main context:

1. **Goal + definition of done** in two lines.
2. **What is known and ruled out:** files and paths by name, hypotheses already disproved, so it doesn't re-explore them.
3. **Bounds:** read-only or may edit? which files exactly?
4. **Report shape and length:** "a table + ≤ 250 words, paths as `file:line`, no long code".
5. If it needs to understand the project: start from `.agents/memory/MEMORY.md` before reading code.

Models: a kit agent's model is the `model:` in its frontmatter (to change it, edit that line; no hook forces a model). Built-in agents inherit the session model unless `model` is passed.
