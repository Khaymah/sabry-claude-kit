---
name: self-maintain
description: Reviewed self-maintenance of the sabry-kit rig - evolves rules, agents, commands and hooks from accumulated work lessons plus official best practices, checks Claude Code compatibility via the llms.txt index, and opens a justified PR with no auto-merge. Use on `/sabry-kit:self-maintain`, from the weekly Routine, or when the user says "صيانة الكيت" / "طوّر الكيت".
---

# self-maintain: sabry-kit self-maintenance (reviewed, no auto-merge)

Reply in the owner's language (profile; default Egyptian Arabic).

Purpose: make the `sabry-kit` rig (rules · agents · commands · hooks) **improve as the work evolves** and stay compatible with Claude Code, **without changing behavior without permission**. Output is always a **PR for review**; the owner decides.

## Governing rules

- **No auto-merge.** Open the PR and stop. The owner reviews and merges.
- **No guessing.** Every change must rest on a **source actually read** in this run, not memory. A link returning 404 = nonexistent; don't build on it.
- **Small, focused changes.** Each change has a one-line reason tied to its source. No broad refactors without need.
- **Respect owner rules:** commit and PR messages **in English**, **no AI attribution**, any subagent explicitly `model: sonnet`.

## Sources, in order (read them, don't assume)

**Most important first, the core of improvement (this is what actually improves the rules):**
1. **Accumulated rig lessons (local in the repo):** `AGENT_LEARNINGS.md` · `agent-memory/` · `Patterns/` · `Anti-patterns/` · `Decisions/`. Strongest source: every success/mistake at work = a rule to improve.
2. **Official best practices:** `https://code.claude.com/docs/en/best-practices.md`, recommended Claude Code practices.

**Second, technical compatibility (so the rig doesn't break if Claude Code changes a mechanism):**
3. **LLM-oriented docs index:** `https://code.claude.com/docs/llms.txt`. Start there and **get the exact links from it at run time** (don't hardcode URLs that may move). Pages relevant to the rig: `memory.md` · `claude-directory.md` · `hooks.md` · `hooks-guide.md` · `sub-agents.md` · `agents.md` · `settings.md` · `settings-reference.md` · `commands.md` · `skills.md` · `plugins/overview.md` · `plugins/manifest-reference.md` · `plugins/marketplace-reference.md`. (Each page has a plain `.md` version.)

**Third, "what changed" signal (tells you which docs page to revisit; not an engine itself):**
4. **Official CHANGELOG:** `https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md` (the docs release-notes page redirects to it). Read only releases newer than the last maintenance; if a new feature concerns the rig, go back to its docs page (2, 3).

> If the network is unreachable, work on source (1) only, say so explicitly in the PR, and never invent content from sources you didn't read.

## Steps

1. **Start with your lessons + best practices (sources 1, 2).** Look for a rule/agent that can improve based on a recurring lesson or a recommended practice.
2. **Scope "what's new" for compatibility.** Get the last maintenance date (from the last `self-maintain:` PR or the `.self-maintain-last` file); from the CHANGELOG (4) see what changed since that affects rig mechanisms, and go to the relevant docs page (3) for the right detail.
3. **Review every asset in the rig:** `rules/*.md` · `agents/*` · `commands/*` · `hooks/*` against (1, 2) for substance and (3, 4) for compatibility.
4. **Apply only focused, justified changes.** Each change = reason + source (lesson file, docs link, or release number). Follow project rules. Run any available check (e.g. `python3 hooks/test_enforce_commit_style.py` if you touched the commit hook).
5. **Nothing worth it -> no empty PR.** Update `.self-maintain-last` with today's date and say "مفيش جديد يستحق".
6. **Open a PR** (if there are changes): branch `self-maintain/<YYYY-MM-DD>` · English commit with no AI attribution · English description with Before/After + How + a list of each change with its reason and source · title `self-maintain: <YYYY-MM-DD>` · **do not merge**; tell the owner in one line that a PR is ready.
7. **If you opened a PR**, follow it to green (CI) without merging.

## Running

- Manual: `/sabry-kit:self-maintain`
- Weekly: a cloud Routine on the `sabry-claude-kit` repo runs the same command and opens a PR for review.
