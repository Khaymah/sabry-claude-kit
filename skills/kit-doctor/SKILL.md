---
name: kit-doctor
description: Scans the user's Claude Code setup (plugins, skills, agents, commands, hooks, settings, CLAUDE.md) for conflicts with sabry-kit or the profile; fixes only with consent, with backup and undo. Use on `/sabry-kit:kit-doctor` or `/kit-doctor`, after kit-setup, on a conflict warning, or when the user says "فيه حاجة بتتعارض" / "نضّف الإعدادات" / "check conflicts".
---

# 🩺 sabry-kit doctor

Reply in the owner's language (profile; default Egyptian Arabic).

Goal: the kit is the only brain, with no other instructions or hooks pulling the other way. **Fix nothing without explicit consent.**

Kit dir = two levels above this skill's dir (the base directory shown when the skill loaded).

## 1. Scan

```bash
python3 "<kit>/hooks/doctor.py" scan --json
```

Each finding has: `id` · `severity` (high / medium / low / info) · `title` · `evidence` · `why` · `fix.type`.

## 2. Show

One table sorted by severity, one line per row:

| | Conflict | Where | Fix |
|---|---|---|---|
| 🔴 | … | short path | auto / manual |

- **`manual`** = no automatic fix (a CLAUDE.md line, a project-specific pre-commit...). State the exact step from `why` beside it.
- **No findings** -> say "✅ مفيش تعارضات" and finish.

## 3. Ask

One `AskUserQuestion`, **multiSelect**, at most 4 options:

- If automatic findings <= 4: one option per finding (title + exact fix + side effect, e.g. "disable the whole productivity plugin, not just the skill").
- If more: group them: "كل الـ 🔴" · "كل الـ 🟠" · "كل الـ 🟡" · "اختار واحد واحد" (then ask a second round).

Never choose for them. If they pick nothing -> do nothing.

## 4. Fix

```bash
python3 "<kit>/hooks/doctor.py" fix <id> <id> ...
```

The result has `fixed`, `skipped`, and an `undo` command. Then run `scan` again and show what remains.

## 5. Close

- **Fixed:** one line each.
- **Remaining manual:** with the step.
- **Undo:** `python3 "<kit>/hooks/doctor.py" undo` restores exactly the last run; `runs` lists the runs that can be undone.
- **Plugin disabled:** takes effect next session. If the plugin is synced from claude.ai, confirm with `/plugin` that it is off.

## What gets checked

| Category | Examples |
|---|---|
| Model | a hook writing `model` on every Agent · `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` |
| Duplicates | another copy of sabry-kit · `~/.claude/agents|skills|hooks` symlinked to the kit · an agent or skill with the same name as one in the kit · kit hooks also registered in settings |
| Memory | auto memory off · global `autoMemoryDirectory` · plugins managing MEMORY.md/CLAUDE.md their own way · plans in another path |
| Commits | `attribution` adding an AI signature · a plugin or CLAUDE.md demanding `Co-Authored-By` |
| Workflow | a plugin forcing brainstorm/plan/TDD on every task |
| Cost | `effortLevel` · `autoCompactWindow` · `CLAUDE_CODE_MAX_OUTPUT_TOKENS` above `cost_profile` · plugins injecting context every session |
| Security | secret scan not installed because of husky or a custom pre-commit |
| CLAUDE.md | lines demanding comments/JSDoc, haiku, or an AI signature |
| Command names | a kit command named like a built-in Claude Code command (e.g. `/doctor`) or a skill/command in another plugin |

A rule turned off in the profile (e.g. `commit_style: false`) -> its conflicts are not reported.
