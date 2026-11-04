# sabry-kit

[العربية](README.md) · **English**

One portable brain for your coding agent. It asks how you work once and keeps the answers as top-priority settings. It keeps each project's memory inside that project, stops secrets from being committed, and finds plugins or settings that fight it, then fixes them with your consent.

Built for [Claude Code](https://code.claude.com) as a plugin. Its hooks also run under Codex CLI, Gemini CLI and Cursor ([details](hooks/README.md#8-أدوات-تانية-codex--gemini-cli--cursor)).

---

## Contents

1. [Quick start](#quick-start)
2. [What it does](#what-it-does)
3. [Commands](#commands)
4. [The agent family](#the-agent-family)
5. [Inside every project: `.agents/`](#inside-every-project-agents)
6. [Your settings (the profile)](#your-settings-the-profile)
7. [Cost and performance](#cost-and-performance)
8. [Repository layout](#repository-layout)
9. [Other ways to install](#other-ways-to-install)
10. [Updating](#updating)
11. [Customizing](#customizing)
12. [Security and privacy](#security-and-privacy)

---

## Quick start

**1. Install the plugin** from inside Claude Code:

```text
/plugin marketplace add Khaymah/sabry-claude-kit
/plugin install sabry-kit@sabry-kit
```

**2. First-run setup:** two minutes of questions; your answers become top-priority settings:

```text
/sabry-kit:kit-setup
```

**3. Conflict check:** finds any plugin, skill, hook or setting that fights the kit, and fixes only what you approve:

```text
/sabry-kit:kit-doctor
```

**4. Open any project.** `.agents/` is set up automatically, and from the next session memory and plans are written inside the project.

> Requirements: Python 3.8+ on PATH (every hook is stdlib only) and Git. Works on Windows, macOS, Linux and in Claude Code cloud sessions.

---

## What it does

| Feature | Details |
|---|---|
| 👤 **Top-priority profile** | `/sabry-kit:kit-setup` asks for your name, language, reply style, working mode, stack, cost vs quality and which rules to enforce. The answers are injected **first** in every session and override any rule, CLAUDE.md or other plugin |
| 🗂️ **Each project keeps its memory** | Auto memory, agent memory, plans, temp files and session copies live in `.agents/` inside the project, not in `~/.claude`. Remove the kit and nothing is lost |
| 🔐 **Secret scan before every commit** | API keys, tokens, private keys, `.env` files. Runs as a Claude Code hook and as a git pre-commit hook, so the project is protected from any tool or person |
| 🩺 **Conflict doctor** | `/sabry-kit:kit-doctor` scans everything installed, ranks conflicts by severity, and fixes them with your consent, with a backup and one-command undo. Once a day it alerts you to a high-severity conflict |
| 🎭 **Agent family** | 18 agents with clear roles (CTO · PM · BA · Market Research · Security · DevOps …), all in the same compact shape, each reading its role file from `Roles/` |
| 🔒 **Rules enforced by hooks** | English commits with no AI attribution · code without comments · Next.js layout · duplication warning · team review reminder. Each one can be switched off in the profile |
| 🔌 **Any AI agent** | `hooks/adapt.py` runs the same hooks under Codex, Gemini CLI and Cursor without forking them |
| 💸 **Lower cost** | Smaller context per session, lighter agents, cheaper defaults ([details](#cost-and-performance)) |

---

## Commands

| Command | What it does |
|---|---|
| `/sabry-kit:kit-setup` | First-run setup, or change your settings |
| `/sabry-kit:kit-doctor` | Find conflicts and fix them with consent |
| `/sabry-kit:kit-stats` | Where the tokens went: per session and per tool, the largest results, re-read files, and savings backed by the numbers |
| `/sabry-kit:team-review` | Parallel review of changes (security · correctness · tests · UX), every finding verified before it is shown |
| `/sabry-kit:project-audit` | Full project audit: security, quality, performance, architecture, with an Arabic report |
| `/sabry-kit:self-maintain` | Maintain the kit itself: opens a PR with improvements, never auto-merges |
| `/sabry-kit:brag-slim` | A short launch video for a project or site |
| `aurora-dark-ui` · `moonflower-design-system` | Design systems loaded automatically for UI work in that style |

> The names avoid Claude Code's built-in commands (such as `/doctor`) and other plugins; `kit-doctor` warns you if a clash appears later.

---

## The agent family

The right role activates from the context of the request (full table in [Roles/README.md](Roles/README.md)). Each agent's model comes from `model:` in its file; all are `sonnet` today.

| Area | Agents |
|---|---|
| Decisions and product | `cto` · `senior-pm` · `business-analyst` · `market-researcher` · `growth-strategist` · `business-developer` |
| Building | `senior-engineer` · `backend-architect` · `Frontend Developer` · `Database-Optimizer` · `devops-sre` · `qa-tester` · `tech-writer` |
| Review (read-only) | `code-reviewer` · `security-reviewer` · `cyber-security` · `ux-reviewer` · `ui-ux` |

Order for a new product idea: `market-researcher` (worth it?) → `senior-pm` (what to build?) → `business-analyst` (requirements) → `cto` (architecture).

---

## Inside every project: `.agents/`

```text
your-project/
  .agents/
    memory/          auto memory (MEMORY.md + one file per topic)        ✅ git
    agent-memory/    per-agent memory (.claude/agent-memory links here)  ✅ git
    plans/           plan-mode files                                      ✅ git
    scratch/         temp files instead of /tmp                           ❌
    sessions/        session transcript copies                            ❌
    profile.json     (optional) settings for this project only
    secrets-allowlist  (optional) secret-scan exceptions
```

- **First session in a project:** sets this up automatically; the hook skips steps that are already done.
- **Old memory:** copied once from `~/.claude/projects/`; the original stays where it was.
- **Project files:** no tracked file is edited. Machine-specific paths go to `.git/info/exclude`.
- **When it takes effect:** Claude Code picks up the new memory path from the **next session**.
- **Memory is committed:** so it travels with the project to any machine. The secret scan stops any commit that contains a secret.

Details and switches: [hooks/README.md › storage](hooks/README.md#5-التخزين-جوه-المشروع-agents).

---

## Your settings (the profile)

| File | Contents |
|---|---|
| `~/.agents/profile.json` | `kit-setup` answers and rule switches (`settings`) |
| `~/.agents/profile.md` | Free-form personal context (goals, constraints, preferred hosting); read only for strategic decisions |
| `<project>/.agents/profile.json` | Override for one project |

- **Order:** kit defaults < `~/.agents/profile.json` < project profile < `SABRY_KIT_<KEY>` env vars (for example `SABRY_KIT_SOUNDS=0`).
- **Switched-off rule:** not injected at all, and its hook stays silent.
- **Where your data lives:** always outside the kit repository, so the kit stays generic and shareable.

Full list of switches: [hooks/README.md › profile](hooks/README.md#2-الـ-profile-إعداد-أول-مرة).

---

## Cost and performance

| Change | Effect |
|---|---|
| The profile is injected as a ~1KB summary; personal context is read on demand | instead of 9KB every session |
| Switched-off rules are not injected; path-scoped rules become a pointer; `code-tools` only when `code-review-graph` is installed | ~15% less context per session |
| All agents follow the same compact shape (dropped the memory instructions Claude Code already injects) | 3 agents from 52KB to 8KB |
| Defaults: `effortLevel: high` · `autoCompactWindow: 200000` · `CLAUDE_CODE_MAX_OUTPUT_TOKENS: 32000` · `BASH_MAX_OUTPUT_LENGTH: 20000` | smaller context per turn, shorter outputs |
| Subagent briefing template (`rules/subagents.md`): goal, what is ruled out, report length cap | shorter reports entering the main context |
| `cost_profile` in the profile, checked by `/sabry-kit:kit-doctor` | alert when settings cost more than you chose |
| Token meter (`usage.py`) + `/sabry-kit:kit-stats` | every session is measured: exactly where the waste is |
| `read-budget`: no accidental full read of a file over 800 lines | read only the part needed, since results are re-sent every turn |
| `verify-reminder`: a check before "done", using the project's own commands | fewer bugs, less rework |

---

## Repository layout

| Path | Purpose |
|---|---|
| `.claude-plugin/` | Plugin and marketplace manifests |
| `agents/` | The 18 agents |
| `Roles/` | One file per role (thinking frame · reply template · anti-patterns), read by the agent before it works |
| `rules/` | Rules injected every session (communication · working mode · language · comments · subagents · storage …) |
| `skills/` | Commands and design systems (table above) |
| `hooks/` | Every hook plus `kit_profile.py`, `doctor.py`, `adapt.py` and the tests. **Full guide: [hooks/README.md](hooks/README.md)** |
| `sounds/` | Notification sounds + `play.py` (Windows · macOS · Linux) |
| `Stacks/` | Per-stack guidance (Next.js · Bun/Hono · Node · React · Go · Rust · PHP · .NET · Astro · GraphQL) |
| `Patterns/` · `Anti-patterns/` · `Decisions/` | Accumulated knowledge: what worked, what to avoid, why decisions were made (ADRs) |
| `Quality-Gate.md` | The eight axes for architectural decisions |
| `CommunicationProfiles.md` | Writing style per audience |
| `PersonalContext.md` | **Template** for personal context (the real one is `~/.agents/profile.md`) |
| `CLAUDE.md` · `settings.json` | For the symlink install (method 2 below) |
| `_Audit/` · `_Archive/` | Older audit output and archived material |

---

## Other ways to install

### Try it: one session from a local clone

```bash
git clone https://github.com/Khaymah/sabry-claude-kit.git ~/sabry-claude-kit
claude --plugin-dir ~/sabry-claude-kit
```

### Machine-wide `CLAUDE.md` and `settings.json` (symlinks)

The plugin brings agents, skills and hooks, but not `CLAUDE.md` or `settings.json`. To use those too:

**macOS / Linux / WSL**

```bash
cp -r ~/.claude ~/.claude.backup 2>/dev/null
mkdir -p ~/.claude
KIT=~/sabry-claude-kit
ln -sfn "$KIT/CLAUDE.md"     ~/.claude/CLAUDE.md
ln -sfn "$KIT/settings.json" ~/.claude/settings.json
ln -sfn "$KIT/rules"         ~/.claude/rules
```

**Windows (PowerShell as Administrator or with Developer Mode)**

```powershell
$Kit = "$HOME\sabry-claude-kit"
New-Item -ItemType Directory -Force "$HOME\.claude" | Out-Null
New-Item -ItemType SymbolicLink -Force -Path "$HOME\.claude\CLAUDE.md"     -Target "$Kit\CLAUDE.md"
New-Item -ItemType SymbolicLink -Force -Path "$HOME\.claude\settings.json" -Target "$Kit\settings.json"
New-Item -ItemType SymbolicLink -Force -Path "$HOME\.claude\rules"         -Target "$Kit\rules"
```

- **The kit's `settings.json`:** registers the marketplace and enables `sabry-kit@sabry-kit`, so the plugin installs itself.
- **`agents/`, `skills/`, `hooks/`:** don't symlink them, or everything shows up twice (`kit-doctor` flags it).
- **Hooks:** never run from symlinks; they come from the plugin only.

### Codex · Gemini CLI · Cursor · others

| Tool | Instructions | Hooks |
|---|---|---|
| Codex CLI | `cp ~/sabry-claude-kit/CLAUDE.md ~/.codex/AGENTS.md` | `~/.codex/hooks.json`, same shape as Claude Code |
| Gemini CLI | `cp ~/sabry-claude-kit/CLAUDE.md ~/.gemini/GEMINI.md` | `~/.gemini/settings.json` through `adapt.py gemini` |
| Cursor | copy `rules/` to `.cursor/rules/` | `~/.cursor/hooks.json` through `adapt.py cursor` |
| Windsurf · Copilot · others | copy `CLAUDE.md` into the tool's instruction file | secret scan works through the git pre-commit hook |

Copy-ready config per tool and a what-runs-where table: [hooks/README.md › other tools](hooks/README.md#8-أدوات-تانية-codex--gemini-cli--cursor).

---

## Updating

```text
/plugin update sabry-kit@sabry-kit
```

With symlinks, or when developing the kit:

```bash
cd ~/sabry-claude-kit && git pull
```

> ⚠️ **2026-11 update:** the repository history was rewritten to remove personal data. A clone made before that needs `git fetch origin && git reset --hard origin/main` (this discards unpushed local changes) or a fresh clone.
> If your kit folder is `~/.claude` itself: copy `.claude.json` somewhere else **before** the reset and put it back after. It was removed from the repo because it is Claude Code's per-machine state, and it is now in `.gitignore`, so it won't be touched again.

A new machine follows the same quick start. The profile is set once per machine, or copy `~/.agents/profile.json` and `profile.md`.

---

## Customizing

- **Your settings:** run `/sabry-kit:kit-setup` at any time. Don't edit kit files to change a personal preference.
- **New agent:** a file under `agents/` plus a role file under `Roles/` (steps in [Roles/README.md](Roles/README.md#إضافة-دور-جديد)).
- **New skill:** a folder under `skills/` with a `SKILL.md`, named so it doesn't clash with a built-in command.
- **New hook:** [hooks/README.md › adding a hook](hooks/README.md#9-إضافة-hook-جديد).
- **Technical decision:** an ADR in `Decisions/`; lessons go to `Patterns/` or `Anti-patterns/`.
- **After any change, verify:**

```bash
python3 hooks/verify-hooks.py
```

---

## Security and privacy

- **Secrets:** never in the repo or in `.agents/`. `scan-secrets` blocks the commit; use `allow-secret` for an exception and `git commit --no-verify` for a deliberate bypass.
- **Personal data:** lives in `~/.agents/` outside the kit. Don't put it in `PersonalContext.md` (a template) or anywhere in the repo.
- **`settings.json`:** read it before applying it; it grants permissions and changes defaults.
- **`kit-doctor`:** changes nothing without your consent. Every change is backed up in `~/.agents/doctor/runs/` and undone with `doctor.py undo`.

Issues and pull requests are welcome.
