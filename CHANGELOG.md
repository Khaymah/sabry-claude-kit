# Changelog

## 0.3.0 — 2026-11-14

Plan: `Plan/2026-11-14-multi-provider-smarter-kit.md`.

### Smarter

- **Lessons** (`hooks/lessons.py`): a prompt that reads like a correction asks the agent to record a lesson in `.agents/memory/lessons.md`. General lessons are shown on the first prompt of a session; scoped ones when a matching file is edited or a matching command runs, once per session. A lesson recorded in two projects, or added with `--global`, is copied to `~/.agents/lessons.md` and travels in the `sabry-profile` bundle. Switch: `lessons`.
- **Long-task plans** (`hooks/kit_plans.py`): `.agents/plans/<slug>/plan.md` with phases, acceptance lines and checkboxes. The session brief names the active plan and its next item, the Stop hook asks for the boxes after work, and state is saved before compaction and restored after. Switch: `long_task_plans`.
- **Orchestration** (`/sabry-kit:kit-orchestrate`): seven playbooks (feature, bugfix, idea, release, integration, support, offer), one handoff file, parallel independent steps, a closing table that accounts for every numbered ask.
- **Quality rules**: requirement coverage, a definition of done per task type, clean-context self-review above a size or risk threshold.

### Agents (18 → 24)

- New: `mobile-developer`, `ai-engineer`, `delivery-manager`, `proposal-writer`, `data-analyst`, `seo-content`, `integration-engineer`, `support-triage`, each with a role file in `Roles/`.
- Merged: `cyber-security` into `security-reviewer`, `ux-reviewer` into `ui-ux`.
- Every agent declares a `tier` (`fast`, `balanced`, `strong`) that maps to a model per tool.

### Other tools

- `hooks/kit_install.py --target codex|kimi|opencode|kilo|cline` installs the instructions, profile, skills and agents in each tool's own format, never overwrites the owner's files, and removes exactly what it wrote with `--uninstall`.
- Enforcement hooks run inside Codex CLI and Kimi Code CLI through `hooks/adapt.py`. OpenCode, Kilo Code and Cline get no hooks: they only accept JS/TS plugins.

### Fixed

- **Rules were not reaching the model.** The rules injected at session start had grown past Claude Code's 10,000-character cap on a hook's output, which replaces the text with a 2,000-character preview and a file path. Only the profile and the first rule arrived; working mode, communication, language and completion rules did not. `inject-rules.py` now splits them across `--part 1..4` calls, each under the cap, with a test that fails if a part grows past it. Found by the eval suite: `cto-mode-plans` went from 0.33 to 1.00.
- `team-review` no longer tells kit agents to override the model in their frontmatter.

- **The model was never told where the kit is.** As a plugin the kit lives outside the project, but the rules said `Roles/` and the agents said `.claude/Roles/<name>.md`, so role files, Stacks and the Quality-Gate were not read, in the main session or in subagents. The injected rules now open with the kit's real path, and a `SubagentStart` hook gives the same line to every subagent.
- **`kit-orchestrate` on plan-only work.** At most two agents, each with one narrow question, and the closing message states the decision for every numbered ask instead of pointing at a file.
- **Lessons survive compaction.** Rules, the profile, the project brief and the active plan were already injected again after every compaction (`SessionStart` with source `compact`); lessons were shown once per session and lost. `lessons.py --start` now forgets what it showed when the context is compacted or cleared, so they come back.

### Not verified

- No live run inside Codex CLI, Kimi Code CLI, OpenCode, Kilo Code or Cline: formats come from their official docs and the install is tested against a throwaway home.
- Smoke evals were run once (2026-11-14): `implement-runs-checks` +0.50, `kit-setup-fires` and `kit-doctor-fires` +1.00, `cto-mode-plans` +0.67 after the fix above, `read-budget-uses-range` and `requirement-coverage` pass in both arms (no measured difference). `commit-without-attribution` could not commit in the root sandbox; its hook did block the AI trailer. 
- Agent and orchestration evals, one run per arm, so treat them as indicative: mean Δ went from −0.15 to +0.15 after the kit-location fix (`ai-agent-routes` and `support-agent-routes` +1.00, `market-research-idea` +0.50, five cases pass in both arms, `delivery-agent-routes` fails in both). No case launched the named agent: the model reads the role and answers directly. `orchestrate-feature` was worse with the kit (0.00 vs 1.00, $0.47 to $0.65 a run): it timed out once and otherwise ended on a short message that pointed at the plan file. After the skill change below it scores 1.00 in two runs at $0.19. A run where the skill launches a real team is still unmeasured.

## 0.2.0

First-run setup with a top-priority profile, per-project storage in `.agents/`, secret scanning, the conflict doctor, token meter and `/sabry-kit:kit-stats`, read budget, verify reminder, project brief, cloud-session persistence, the account-wide profile skill, git identity and signing, the eval suite.
