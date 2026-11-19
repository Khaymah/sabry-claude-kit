# Changelog

## Unreleased

- **Turn anchor** (`hooks/turn-anchor.py`, UserPromptSubmit): long sessions drifted back to English and forgot the basics, because the rules arrive once, far behind English tool output. Every owner message now carries one line built from the profile (reply language · questions through `AskUserQuestion` · no code without permission · no AI attribution), about 60 tokens. When the profile is Arabic and the last reply was mostly English (code, paths and links not counted), it adds a direct correction. Switch: `turn_anchor`.
- **Scope table before code**: a change across repos or apps, or one that adds a field or behaviour to something existing, shows what changes and what stays unchanged, and waits for approval. A new API field goes in the detail response only unless the list is named.
- **Files sent to the owner** are `.md` or `.pdf` with the key content repeated in the reply.
- Skill-trigger evals (`--tag skill-fires`, `--tag skill-quiet`); `architecture-decision` now loads for any one-line technology choice; the self-maintenance note shows weekly.

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

### Lighter

- **Injected rules cut from about 18,600 to 11,000 characters** (roughly 41% less text at every session start and after every compaction). Behaviour stays in the rules; templates, tables and lists moved to `Reference/` (progress log, definition of done, long-task plans, subagent briefing, stack list, git identity), read only when the rule that names them applies. Smoke evals after the cut, two runs per arm: mean Δ +0.46 (it was +0.38 on one run before), every behavioural case unchanged or better. `requirement-coverage` failed one of two runs and passed two of two on a repeat.

- **One closing note.** The verify, plan and team-review reminders now reach the model through `stop-reminders.py` as a single note with one instruction: answer in one short addition, do not restate the report. The team-review reminder fires only for three or more code files, 150 or more changed lines, or a security-sensitive path; a small change gets a re-read of the diff, as the completion rule already said.

### Updating

- **Existing profiles need no migration**: a profile stores only the owner's choices and new switches come from the defaults. `kit_update.py` tells an owner with an older local profile, once per version, what is new, which switches were added and which installs in other tools are stale. Profiles and installs now record the kit version that wrote them.

### Security and robustness (team review of the 0.3.0 hooks)

Three reviewers (correctness, security, test gaps) read the new hook code; every finding below was reproduced or checked before it was fixed, and each has a regression test. Two findings were refuted: `Stop` does accept `additionalContext`, and the OpenCode `permissions` list is the documented form.

- **A repository can no longer speak for the owner.** `<project>/.agents/profile.json` now contributes only `stack`, `language`, `verbosity` and known switches, cannot turn a protection off, and is not a profile by itself. Lessons in a repository's `lessons.md` are shown as that repository's notes unless the owner recorded them (`~/.agents/lessons-trusted.json`, carried in the bundle). Plan text is labelled as repository content. Symlinked lessons and plan files are ignored.
- **No regular expressions from a repository.** Lesson command patterns are plain text with `*`, matched on word boundaries; globs are bounded; fields are capped when read. A hostile pattern used to stall every Bash call for the hook's full timeout.
- **No lost owner text.** `lessons.py add` and `prune` keep lines they cannot parse. `kit_install` leaves a file with a damaged marker untouched, keeps an owner hook that mentions an adapter, preserves bytes that are not UTF-8, never deletes a Kilo config it did not create, removes files from earlier installs that the kit no longer ships, and records what it wrote even when it stops midway.
- **Lessons:** duplicates need the same words and the same scope (so "tabs" and "spaces", or port 3000 and 3001, are both kept); a lesson that looks like it holds a secret is refused; nothing is promoted to the owner-wide file silently; more than ten general lessons are counted, not hidden.
- **Plans:** fenced checkboxes are not items; `Status` is read anywhere; odd transcript lines no longer silence the hooks; edits made before the plan existed do not trigger the reminder.
- **Other hooks:** the team-review baseline is not retaken after a resume or a compaction; sensitive paths are matched as whole words; non-ASCII file names work; the three Stop reminders run side by side; the adapter merges notes across a multi-file patch and marks `--once` only after a successful run; the owner's own files in `~/.claude/rules` no longer switch the kit's rules off; an over-long section is split, not truncated; pre-release versions sort before the release.
- **Profile bundle:** the private signing key is included only with `--with-signing-key`.

Left as they are, known: state files written by two sessions at once can lose an update (a reminder may show twice); a read-only agent on Kimi can still write through its shell; the same repository cloned twice counts as two projects when a lesson is offered for promotion.

Smoke evals after these fixes, two runs per arm: mean Δ +0.52, every behavioural case at 1.00 with the kit (`cto-mode-plans`, `implement-runs-checks`, `kit-setup-fires`, `kit-doctor-fires`, `reply-language`, `requirement-coverage`, `read-budget-uses-range`). `commit-without-attribution` still cannot commit inside the root sandbox.

### AI attribution on GitHub

- **Found:** a cloud session's platform appends `Generated by [Claude Code](…)` to a pull request body after the request has left the session. Sending a body without the line through `gh api` returned the same body with the line added, so no hook in the session can block it.
- **Fixed where it can be:** `attribution-guard.py` installs `.github/workflows/no-ai-attribution.yml` in every GitHub repository the owner opens and sets Claude Code's own `attribution` switch in `.claude/settings.json`. The workflow removes attribution lines from pull requests, issues, comments, reviews and releases on GitHub. Run in this repository: the three existing pull requests are clean.
- **Hook gaps closed:** raw API calls with `curl` and similar, and MCP tools whose server name does not contain `github`.
- **Cannot be changed:** GitHub's "with Claude" badge on timeline events. It records the app that performed the action; only acting with the owner's own credentials avoids it.

### Offers

- **`/sabry-kit:quote`** produces a technical and financial offer as an A4 PDF in the owner's fixed layout, taken from a real offer: cover letter and summary table, technical offer (understanding, compliance matrix or scope, architecture, timeline, training and warranty), financial offer (component prices, totals, bundle discount, extra terms, payment schedule, inclusions, exclusions, assumptions, general terms). The model writes JSON; `render.py` owns headings, order, styling and every number, and refuses to render with a gap marker, a missing field or payments that do not add up to 100%. Reproducing the reference offer from data gives the same 9 pages with the same page breaks.
- Sender identities and reference examples live in `~/.agents/quote/` and travel in the profile bundle; nothing of the owner's is in the kit. Fonts (IBM Plex Sans Arabic, Inter) ship with the skill under the OFL.
- `proposal-writer` hands priced offers to the skill and keeps the cover email and client replies. `kit_profile.py bundle` falls back to the synced profile's files when local copies are missing.

### Smallest complete change (adapted from Ponytail, MIT)

- **`rules/smallest-change.md`**: before writing code, map what the change must reach, then take the first rung that fully works: does it need to exist, already in the codebase, standard library or platform, an installed dependency, one line, only then the minimum code. Never cut validation, data-loss handling, security or accessibility; new branching logic leaves one small test. Injected every session, and given to coding subagents on `SubagentStart` with the comment rule (subagents never received the session rules before).
- **`shortcut:` comments are allowed**: `shortcut: <the limit>, <when to upgrade>` is the second exception to the no-comments rule, enforced by the hook (a shortcut without an upgrade trigger is still refused). `/sabry-kit:kit-debt` collects them into `Plan/debt.md`.
- Idea and ladder from [Ponytail](https://github.com/DietrichGebert/ponytail) by Dietrich Gebert (MIT).

### Review format (adapted from Ponytail, MIT)

- `code-reviewer` and `team-review` read beyond the diff (callers, consumers of renamed fields in untouched files, real load, untested risky logic) and write every finding in four fixed parts: what the code does, what goes wrong with the concrete input, the fix, and what happens if it is skipped. "Can be cut" is a finding type.

### Native plugins for other tools (idea from Ponytail)

- **Kimi Code:** `kimi.plugin.json` installs the kit with `/plugins install <repo>`: rules through `systemPromptPath`, skills, the agents in Kimi's format, the hooks, and the owner's profile on the first prompt.
- **Codex:** `.codex-plugin/plugin.json` and `.agents/plugins/marketplace.json` (`codex plugin marketplace add Khaymah/sabry-claude-kit`). Its hooks point at `adapters/codex/hooks.json` on purpose: Codex otherwise loads `hooks/hooks.json`, the Claude Code hooks, which do not fit Codex. Rules and profile arrive at session start.
- **OpenCode and Kilo Code:** `adapters/opencode/index.js` injects the rules and profile every turn and runs the commit, secret and comment checks before a tool runs, under both OpenCode plugin APIs. `kit_install --target opencode|kilo` registers it and stops writing a separate rules file; a config with comments falls back to the old behaviour.
- `hooks/build_adapters.py` generates the Kimi and Codex files from the kit's sources; `--check` runs in the suite so a stale copy fails it.

### Hidden-check measurement

- `evals/hidden_checks.py` runs a case with and without the kit, then runs tests the agent never saw (`evals/<case>/hidden/`) against what each run left behind, and measures code lines, test lines and cost. `claude plugin eval` keeps only the last `--case`, so it runs one eval per case.
- First result, after the smallest-change rule, two runs per arm: both arms pass every hidden check. `orchestrate-team`: 92 code lines with the kit against 116 without (−21%), $0.34 against $0.23. `orchestrate-implement`: 35 against 38 lines, $0.18 against $0.12. The kit writes somewhat less code at equal correctness, and costs about 50% more per task on these small tasks; where that cost comes from is not measured yet.

### Stacks and databases

- **`Stacks/Database.md`**, for every stack: UUIDv7 keys, `timestamptz`, money as integer minor units, constraints in the database, partial unique indexes with soft delete, index rules proven with `EXPLAIN`, no N+1, keyset pagination, no read-check-write (atomic update, `FOR UPDATE` or a constraint), idempotency keys, expand → migrate → contract migrations with timeouts, pool sizing, backups with rehearsed restores, least-privilege roles, tests against a real PostgreSQL.
- **Configuration lives in the database.** A `SystemSettings` table with a typed registry in code, defaults seeded at boot, fail-fast validation, an in-process cache refreshed by `LISTEN/NOTIFY`, secrets encrypted with AES-256-GCM and write-only through the API, and a history table. The environment keeps only `DATABASE_URL`, `SETTINGS_ENCRYPTION_KEY`, `APP_ENV` and `PORT` (the owner's decision: secrets in the table, encrypted).
- **`Stacks/Bun-Hono.md` rewritten** in English: the bootstrap-only `Env`, a `Settings` module, `Bun.password` and other built-ins before packages, and a checklist that no longer asks for file headers, JSDoc and inline comments, which contradicted the comment rule. The Next.js checklist had the same contradiction and is fixed; it gains a settings section. The other stacks gain a short configuration and database section with their language's way of doing it.
- `Database-Optimizer` and `backend-architect` read `Stacks/Database.md` first; the working-mode rule points every database task at it.

### Not verified

- No live run inside Codex CLI, Kimi Code CLI, OpenCode, Kilo Code or Cline: formats come from their official docs and the install is tested against a throwaway home.
- Smoke evals were run once (2026-11-14): `implement-runs-checks` +0.50, `kit-setup-fires` and `kit-doctor-fires` +1.00, `cto-mode-plans` +0.67 after the fix above, `read-budget-uses-range` and `requirement-coverage` pass in both arms (no measured difference). `commit-without-attribution` could not commit in the root sandbox; its hook did block the AI trailer. 
- Agent and orchestration evals, one run per arm, so treat them as indicative: mean Δ went from −0.15 to +0.15 after the kit-location fix (`ai-agent-routes` and `support-agent-routes` +1.00, `market-research-idea` +0.50, five cases pass in both arms, `delivery-agent-routes` fails in both). No case launched the named agent: the model reads the role and answers directly. `orchestrate-feature` was worse with the kit (0.00 vs 1.00, $0.47 to $0.65 a run): it timed out once and otherwise ended on a short message that pointed at the plan file. After the skill change below it scores 1.00 in two runs at $0.19. `orchestrate-implement` (a two-file fix with a hidden race, one run per arm): both arms passed an 11-check hidden test, the kit declined to launch a team for a change that small and closed the report per ask with what it had not verified, at $0.21 and 41 s against $0.12 and 32 s. `orchestrate-team` (nine files, seven asks across authorization, validation, concurrency, pagination, money and XSS; one run per arm): both arms passed all 23 checks of a hidden test in about 78 s, $0.34 with the kit against $0.27 without. The kit again chose not to launch a team. Its final message was the team-review reminder triggered by the Stop hook, not the closing report, which is why the suite's judge failed it. Conclusion so far: on tasks up to this size the kit does not change the correctness of the code; what it measurably changes is behaviour (asking before coding, running checks, no AI attribution, routing to the right skill).

## 0.2.0

First-run setup with a top-priority profile, per-project storage in `.agents/`, secret scanning, the conflict doctor, token meter and `/sabry-kit:kit-stats`, read budget, verify reminder, project brief, cloud-session persistence, the account-wide profile skill, git identity and signing, the eval suite.
