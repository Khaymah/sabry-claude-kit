# sabry-kit evals

Measures what the kit adds over plain Claude Code. Every case runs **with** the plugin and **without** it; the difference (Δ) is the kit's contribution, and the report shows the tokens and cost of each arm. Run from the kit root.

| Case | Checks | Tags |
|---|---|---|
| `cto-mode-plans` | Default CTO+PM mode plans and asks; writes no code | smoke · mode |
| `implement-runs-checks` | "نفّذ" fixes the bug and runs the tests before "done" | smoke · quality |
| `commit-without-attribution` | English commit message, no AI trailer | smoke · git |
| `secret-blocked` | A credential put in `.agents/memory` never reaches history; no `--no-verify` | security |
| `read-budget-uses-range` | A question about one function in a 1,600-line file is answered without the whole file entering the context | smoke · cost |
| `market-research-idea` | "تستاهل أبنيها؟" goes to `market-researcher` and ends in one decision | agents |
| `mobile-agent-routes` · `ai-agent-routes` · `delivery-agent-routes` · `proposal-agent-routes` | The request reaches the new agent and the answer follows its role (offline handling · eval and cost before a model · evidence-based order · no invented price) | agents |
| `data-agent-routes` · `seo-agent-routes` · `integration-agent-routes` · `support-agent-routes` | The request reaches the agent and the answer follows its role (metric defined before the query · technical causes before content · paid only from a verified webhook · evidence and severity before a fix) | agents |
| `orchestrate-feature` | A three-ask feature reaches `kit-orchestrate`, agents are launched through one handoff file, and all three asks are closed (concurrency with a real mechanism) | orchestration |
| `requirement-coverage` | Three asks, one impossible: two are implemented and the third is reported as not done, not dropped or faked | smoke · quality |
| `kit-setup-fires` · `kit-doctor-fires` | The request reaches the kit's skill, not a built-in or another plugin | smoke · skills |
| `reply-language` | No profile → answers the question and suggests `kit-setup` | smoke · language |

## Run

Requires Claude Code ≥ 2.1.269. Cases that use Bash need the sandbox (macOS, Linux, or WSL2 on Windows; on Linux install `bubblewrap` and `socat`, otherwise every run is refused and reported as a score of 0 at $0.00). Run as a normal user: as root the sandbox keeps `.git` read-only, so `commit-without-attribution` cannot commit. Runs use your normal credentials and count against your plan.

Cheap check (smoke cases, one run per arm):

```bash
claude plugin eval . --tag smoke --runs 1 --scaffold --trust-plugin --allow-tools Write Edit "Bash(git *)" "Bash(npm *)" "Bash(node *)" "Bash(bun *)" --max-cost-usd 3
```

Full suite (3 runs per arm):

```bash
claude plugin eval . --scaffold --trust-plugin --allow-tools Write Edit "Bash(git *)" "Bash(npm *)" "Bash(node *)" "Bash(bun *)" --max-cost-usd 15
```

Results land in `evals/results/<timestamp>/` (`report.html`, `aggregate-result.json`; git-ignored). Compare scores **and** tokens/cost before and after any change to the kit.

## Add your own cases

The best cases are your real tasks. For each one, a folder with:

- `prompt.md`: what you would type; frontmatter `max_turns` and `allowed_tools`.
- `case.yaml` + `fixture.sh` if it needs files or a git repo (runs only with `--scaffold`).
- One grader on the result (`regex` on a file or the reply) and one on the process (`tool_used`). Prefer `regex` and `tool_used` (free and stable) over `llm` graders.

Format reference: <https://code.claude.com/docs/en/plugin-evals>.
