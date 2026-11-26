# Playbooks strong on complex tasks

- Status: active
- Goal: Fix every weak playbook, then beat both no-plugin and the old kit by a clear margin on hard tasks, proven by an independent, held-out benchmark on the owner's real stack
- Started: 2026-11-26
- Branch: `feat/serene-franklin-i3i6nb` (PR #6, draft)

## Phase 1: Diagnose
Acceptance: every failed grader and hidden test of the Playbooks arm has a written cause (playbook missing, playbook wrong, not routed, not read, or grader flaw)
- [x] Re-run the 6 failing cases of the Playbooks arm with `--keep-temp` (h1, h2, h3, h5, m3, m4; 3 runs each) to get traces
- [x] Per failure: which playbook was routed and read, which rule was missed or missing, or whether the grader is wrong
- [x] Known from the first run: h1 quality fails 3/3 (lock or atomic decrement not applied), h5 quality 3/3 (no alert on a missing success, no external uptime), m4 quality 2/3 (per-account limit missing), h2 query-count test 1/3, h3 scoped 1/3, m3 BOM 1/3
- [x] Write the causes to `Plan/2026-11-26-playbooks-diagnosis.md`

## Phase 2: Strong benchmark design
Acceptance: 20+ hard tasks on Bun + Hono + Drizzle + Postgres (PGlite), written by an agent that never read Playbooks, split into a dev set and a sealed held-out set; a pilot shows no-plugin passes under 60% of the held-out hidden tests
- [ ] Fixture base: Bun + Hono + Drizzle + PGlite project with the owner's structure (Modules, PascalCase, SystemSettings), seed data, a test harness
- [ ] Task author agent briefed from production failure classes only (concurrency, money, tenancy, auth, idempotency, migrations, performance at 100x, observability, file handling, integrations), never from Playbooks
- [ ] Each task: an Arabic prompt as the owner writes it, hidden tests (instrumented: query counter, concurrent clients, clock control, tampered input), and a rubric only where no test can judge
- [ ] Multi-step tasks: features that touch several modules, a bug with a misleading symptom, a change that must keep old behaviour
- [ ] Validate each hidden test against a broken and a correct reference before use
- [ ] Split: 8 dev tasks (used while fixing) and 12+ held-out tasks (sealed until Phase 4)
- [ ] Pilot: no-plugin, 2 runs per task; drop or harden tasks it passes above 80%

## Phase 3: Fix the playbooks
Acceptance: every cause from Diagnose and every dev-set failure fixed at the source; routing eval green; no growth in session-start context
- [x] F1-F3: playbook-route injects matching playbooks per request and per coding subagent (18/18 runs injected, was 3/18); security index (PR #6 commit 6000dd3)
- [ ] Fix each remaining Phase 1 cause in the playbook, the routing index or the agent brief
- [ ] Rewrite weak playbooks to put the deciding rule first and give a worked fix for the failure seen
- [ ] Run the dev set after each batch (kit arm only) until it beats no-plugin on the dev set
- [ ] Run `evals/playbook-routing` and the skill-trigger evals
- [ ] Check session-start context did not grow (deterministic benchmark)

## Phase 4: Measure
Acceptance: held-out set, 3 arms x 5 runs on Sonnet (plus a smaller Opus check); report with confidence intervals
- [ ] Unseal the held-out set; run no-plugin, old kit, new kit, 5 runs each, Sonnet
- [ ] Opus check: new kit vs no-plugin, 2 runs each
- [ ] Report: per task, per difficulty, hidden-test pass rate with 95% intervals, cost and time; publish to `benchmark/RESULTS.md`

## Phase 5: Decide
Acceptance: owner decides merge and whether phases 4-7 of the original Playbooks plan start
- [ ] Brief for the owner with the decision and its numbers

## Notes
- 2026-11-26: task author agent started in /home/user/bench2 (outside the kit, never reads Playbooks): 20 tasks, PGlite fixtures, broken/fixed references, dev/held-out split, one offline smoke run. Results go to bench2/VERIFY.md and SPLIT.md; copy into the PR branch as benchmark2/ when verified.
- Diagnosis 2026-11-26 ($3.36): playbooks read in 3 of 18 runs (only h5). Main cause is routing, then strict Haiku rubrics and a Bash allow-list that blocked test runs, then content gaps (CSV BOM, no security domain). Fixes F1-F5 in Plan/2026-11-26-playbooks-diagnosis.md.
- Owner, 2026-11-26: fix everything weak first, then be far stronger than both no-plugin and the old kit, measured by a very strong benchmark focused on complex tasks.
- The first benchmark was written by the same session as the Playbooks; the new tasks must come from an agent that never read them, and the held-out set stays sealed while fixing, so the playbooks are not tuned to the test.
- Bun and PGlite are available in the cloud container.
