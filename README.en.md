# sabry-claude-kit

[العربية](README.ar.md) · **English**

My portable AI-coding-agent setup in a single repo: rules, agents, skills, hooks, patterns, and decisions. Clone it on any machine, server, or VPS and keep working the same way, with the same standards, without rebuilding your configuration each time.

Built for [Claude Code](https://www.anthropic.com/claude-code). Parts of it also work with Codex CLI, Gemini CLI, Cursor, and other agents (see [Other tools](#4-other-tools)).

---

## Table of contents

1. [What is this?](#what-is-this)
2. [Repository structure](#repository-structure)
3. [Installation](#installation)
   - [1. Claude Code as a plugin](#1-claude-code-as-a-plugin)
   - [2. Claude Code globally (symlinks)](#2-claude-code-globally-symlinks)
   - [3. Claude Code per project](#3-claude-code-per-project)
   - [4. Other tools](#4-other-tools)
4. [Updating](#updating)
5. [Using it on a new machine](#using-it-on-a-new-machine)
6. [Customizing](#customizing)
7. [Security notes](#security-notes)
8. [Contributing](#contributing)

---

## What is this?

Anyone who uses Claude Code for a while ends up tuning it: rules, custom agents, skills, hooks, a quality bar. That setup lives in `~/.claude` on one machine, and every new laptop, server, or VPS starts from zero.

**sabry-claude-kit** keeps all of it in one Git repository so that moving to a new environment is a `git clone` and a few commands.

It also keeps what I learned along the way: patterns that worked, anti-patterns to avoid, and the reasoning behind technical decisions.

## Repository structure

### Folders

| Folder | Purpose |
|---|---|
| `.claude-plugin/` | Plugin manifest, so the kit can be loaded as a Claude Code plugin |
| `agents/` | Custom sub-agent definitions |
| `skills/` | Reusable skills the agent loads when a task matches |
| `hooks/` | Hooks that run automatically at points in the agent workflow |
| `rules/` | Rule files that shape how the agent writes and reviews code |
| `Patterns/` | Approaches that worked and are worth repeating |
| `Anti-patterns/` | Approaches to avoid, and why |
| `Decisions/` | Technical decisions and their reasoning |
| `Roles/` | Role profiles the agent can work under |
| `Stacks/` | Guidance specific to a technology stack |
| `agent-memory/` | Persistent notes kept for agents between sessions |
| `sounds/` | Sound files used for notifications |
| `_Audit/` | Audit and review output |
| `_Archive/` | Retired material kept for reference |

### Root files

| File | Purpose |
|---|---|
| `CLAUDE.md` | Main instructions loaded into every session |
| `settings.json` | Claude Code settings (permissions, hooks wiring, and so on) |
| `.claude.json` | Claude Code client configuration |
| `Quality-Gate.md` | The quality checklist work must pass before it counts as done |
| `seatbelt.json` | Safety guard configuration |
| `AGENT_LEARNINGS.md` | Lessons the agents have accumulated |
| `CommunicationProfiles.md` | How the agent should communicate in different situations |
| `PersonalContext.md` | Template for personal context. The real one lives outside the kit in `~/.agents/`, written by `/sabry-kit:setup` |
| `.sabry-kit-maintain-note`, `.self-maintain-last` | Markers used for keeping the kit up to date |

---

## Installation

### Requirements

- Git
- An AI coding agent: [Claude Code](https://www.anthropic.com/claude-code) (full support), or another tool from [Other tools](#4-other-tools) (partial support)
- macOS, Linux, WSL, or Windows PowerShell

First, clone the repo once:

```bash
git clone https://github.com/Khaymah/sabry-claude-kit.git ~/sabry-claude-kit
```

### 1. Claude Code as a plugin

The quickest way to try it. Start Claude Code with the kit loaded for one session:

```bash
claude --plugin-dir ~/sabry-claude-kit
```

Or install it from the GitHub repo inside Claude Code:

```text
/plugin marketplace add Khaymah/sabry-claude-kit
/plugin install sabry-kit@sabry-kit
```

**First run after installing:**

1. `/sabry-kit:setup` asks a few questions (name, language, working mode, rules) and saves them in `~/.agents/` as top-priority settings.
2. `/sabry-kit:doctor` scans your plugins, skills, agents and hooks, reports what conflicts with the kit, and fixes it with your consent.
3. Open any project: memory, plans and temp files are set up inside it under `.agents/`.

Run `/plugin` to see the exact marketplace name and to enable, disable, or update it.

> Plugins load `agents/`, `skills/`, and `hooks/`. Files such as `CLAUDE.md` and `settings.json` are not applied by a plugin install, so use method 2 as well if you want the kit's global instructions and settings.

### 2. Claude Code globally (symlinks)

This gives you the full kit in every project, and `git pull` updates it instantly.

**macOS / Linux / WSL**

```bash
# Back up what you already have
cp -r ~/.claude ~/.claude.backup 2>/dev/null

mkdir -p ~/.claude
KIT=~/sabry-claude-kit

ln -sfn "$KIT/CLAUDE.md"     ~/.claude/CLAUDE.md
ln -sfn "$KIT/settings.json" ~/.claude/settings.json
ln -sfn "$KIT/rules"         ~/.claude/rules
```

**Windows (PowerShell, run as Administrator or with Developer Mode on)**

```powershell
$Kit = "$HOME\sabry-claude-kit"
New-Item -ItemType Directory -Force "$HOME\.claude" | Out-Null

New-Item -ItemType SymbolicLink -Force -Path "$HOME\.claude\CLAUDE.md"     -Target "$Kit\CLAUDE.md"
New-Item -ItemType SymbolicLink -Force -Path "$HOME\.claude\settings.json" -Target "$Kit\settings.json"
New-Item -ItemType SymbolicLink -Force -Path "$HOME\.claude\rules"         -Target "$Kit\rules"
```

> `settings.json` enables the plugin (`sabry-kit@sabry-kit`), which brings `agents/`, `skills/` and `hooks/`. They are not symlinked, otherwise every agent would show up twice.
>
> ⚠️ Symlinks do not activate hooks. Every hook is registered in `hooks/hooks.json` and comes from the plugin (method 1) via `${CLAUDE_PLUGIN_ROOT}` paths, so it works on any machine unchanged. Details and verification: [hooks/README.md](hooks/README.md).

Then start Claude Code in any project:

```bash
claude
```

### 3. Claude Code per project

To use the kit in one project only, copy the parts you want into that project's `.claude/` folder:

```bash
cd your-project
mkdir -p .claude
cp ~/sabry-claude-kit/CLAUDE.md ./CLAUDE.md
cp -r ~/sabry-claude-kit/agents ~/sabry-claude-kit/skills ~/sabry-claude-kit/rules .claude/
```

Project files take effect for everyone who clones that project, so only copy what you want to share with the team.

### 4. Other tools

The kit is built around Claude Code. Other agents can still use the written parts: instructions, rules, patterns, and decisions. Claude-specific parts (`agents/`, `settings.json`, `.claude.json`, `.claude-plugin/`) will not carry over. Hooks do: `hooks/adapt.py` runs them under Codex, Gemini CLI and Cursor; per-tool setup is in [hooks/README.md](hooks/README.md).

**Codex CLI**

Codex reads an `AGENTS.md` file. Use the kit's instructions as your global one:

```bash
mkdir -p ~/.codex
cp ~/sabry-claude-kit/CLAUDE.md ~/.codex/AGENTS.md
```

For a single project, put it at the project root as `AGENTS.md`. If your Codex version supports skills, point it at the `skills/` folder following the Codex documentation.

**Gemini CLI**

```bash
mkdir -p ~/.gemini
cp ~/sabry-claude-kit/CLAUDE.md ~/.gemini/GEMINI.md
```

**Cursor**

Copy rule files into your project:

```bash
mkdir -p .cursor/rules
cp ~/sabry-claude-kit/rules/* .cursor/rules/
```

Cursor expects `.mdc` or `.md` rule files with its own front matter, so adjust the extension and header if a rule does not load.

**Windsurf, Copilot, and others**

Most agents read a Markdown instruction file (`AGENTS.md`, `.github/copilot-instructions.md`, `.windsurfrules`, and so on). Copy the contents of `CLAUDE.md` into the file your tool expects.

**Claude.ai / Claude Desktop**

Skills can be zipped and uploaded from the Skills section in Claude settings. Zip one skill folder at a time.

---

## 💸 Cost and performance

| Change | Effect |
|---|---|
| The profile is injected as a ~1KB summary; personal context is read on demand | instead of 9KB every session |
| Switched-off rules are not injected; path-scoped rules become a pointer; `code-tools` only when `code-review-graph` is installed | ~15% less context per session |
| All agents follow the same compact shape (dropped the memory instructions Claude Code already injects) | 3 agents from 52KB to 8KB |
| Defaults: `effortLevel: high` · `autoCompactWindow: 200000` · `CLAUDE_CODE_MAX_OUTPUT_TOKENS: 32000` · `BASH_MAX_OUTPUT_LENGTH: 20000` | smaller context per turn, shorter outputs |
| Subagent briefing template (`rules/subagents.md`): goal, what is ruled out, report length cap | shorter reports entering the main context |
| `cost_profile` in the profile, checked by `/sabry-kit:doctor` | alert when settings cost more than you chose |

## Updating

```bash
cd ~/sabry-claude-kit
git pull
```

With the symlink method nothing else is needed. With the copy method, copy the changed files again.

To save a change you made while working:

```bash
cd ~/sabry-claude-kit
git add -A
git commit -m "Update kit"
git push
```

## Using it on a new machine

```bash
git clone https://github.com/Khaymah/sabry-claude-kit.git ~/sabry-claude-kit
# then run the symlink commands from method 2
claude
```

## Customizing

- Edit `CLAUDE.md` to change the global instructions.
- Add a new skill by creating a folder under `skills/` with a `SKILL.md`.
- Add a new agent by adding a Markdown file under `agents/`.
- Record a technical choice in `Decisions/`, and move what you learn into `Patterns/` or `Anti-patterns/`.
- Run `/sabry-kit:setup` once: it asks a few questions and saves the answers in `~/.agents/` as top-priority settings above every kit rule.

## Security notes

This repository may hold configuration that is personal to its author. Before you reuse it or make your own copy public:

- Review `PersonalContext.md` and `CommunicationProfiles.md` for personal details.
- Review `.claude.json`, `settings.json`, and `hooks/` for tokens, API keys, internal URLs, or machine-specific paths.
- Keep secrets in environment variables or a secrets manager, never in the repo.
- Read `settings.json` before applying it. It can grant permissions and run hooks on your machine.

## Contributing

Issues and pull requests are welcome. Please read the code of conduct in this repository first.
