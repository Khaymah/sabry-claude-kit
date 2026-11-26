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
- [x] Fixture base: Bun + Hono + Drizzle + PGlite project with the owner's structure (Modules, PascalCase, SystemSettings), seed data, a test harness
- [x] Task author agent briefed from production failure classes only (concurrency, money, tenancy, auth, idempotency, migrations, performance at 100x, observability, file handling, integrations), never from Playbooks
- [x] Each task: an Arabic prompt as the owner writes it, hidden tests (instrumented: query counter, concurrent clients, clock control, tampered input), and a rubric only where no test can judge
- [x] Multi-step tasks: features that touch several modules, a bug with a misleading symptom, a change that must keep old behaviour
- [x] Validate each hidden test against a broken and a correct reference before use
- [x] Split: 8 dev tasks (used while fixing) and 12+ held-out tasks (sealed until Phase 4)
- [x] Pilot: no-plugin, 2 runs per task ($12.96): 39 of 40 runs passed every hidden test; every task is above 80%, so all need hardening
- [x] Copy /home/user/bench2 (without node_modules, with a script that rebuilds them) into the PR branch as `benchmark2/`, since the container is ephemeral (commit 2baccef)
- [x] Harden: owner chose implicit requirements + larger tasks (2026-11-26); author agent rewriting prompts, misleading symptoms for fix tasks, 5 two-feature tasks (2 dev, 3 held-out)
- [x] Re-sync bench2 into `benchmark2/` (commit 12298cc); hardened pilot ($15.42): 40 of 50 runs pass every hidden test, mean 94%. Tasks that separate: b09, m19, m20, x23 (fail 2/2), b14, m17 (fail 1/2)
- [x] Owner decides: focus on the separating classes (2026-11-26)
- [x] Author adds 10 tasks y26-y35 in the failing areas (payments after timeouts, refunds, legacy data, dates and timezones, all-or-nothing edits, query budgets); 4 dev, 6 held-out
- [x] Pilot the new 10 without the kit ($5.65): 12 of 20 runs pass; separating y26, y28, y31, y33, y35
- [x] Final set (11 tasks): dev b09, m17, y26, y31, y35; held-out m19, m20, x23, b14, y28, y33 (PR commit c182727)

## Phase 3: Fix the playbooks
Acceptance: every cause from Diagnose and every dev-set failure fixed at the source; routing eval green; no growth in session-start context
- [x] F1-F3: playbook-route injects matching playbooks per request and per coding subagent (18/18 runs injected, was 3/18); security index (PR #6 commit 6000dd3)
- [x] Fix each remaining Phase 1 cause: routing done (F1-F2); grader flaws replaced by benchmark2's hidden tests; the content gaps already existed in the playbooks (BOM, release tag, rotation, Retry-After)
- [x] Dev round 1 ($4.42): kit b09 5/5,5/5 · y31 4/4,4/4 · y35 3/4,3/4 · m17 1/5,5/5 · y26 2/5,2/5. Router matched 1 of 5 dev prompts (plain requests carry no risk words; plurals; 'cash' routed to caching)
- [x] Fix: plural matching, everyday words, refunds in money.md, legacy data in migrations.md, always-on four checks in every injection (PR commit 7318763)
- [x] Dev round 2 ($4.47): b09 5/5,5/5 · m17 5/5,5/5 (fixed) · y31 4/4,4/4 · y35 3/4,3/4 (query budget 7-8 vs 4) · y26 2/5,2/5
- [x] Benchmark flaw: y26 hidden tests query "Refunds"."PaymentId" (the reference design); a valid allocations-table design fails in every arm. Author audits all 35 hidden tests for design coupling, adds an alternative correct solution per changed case, and checks y35's budget is fair
- [x] Audit done: six cases decoupled (y26, b09, x21, y35, b14, f06), each with an alternative correct solution in reference/alt; y35 budget 5 and its stale-report suggestion replaced
- [x] Re-pilot after the audit ($2.13, no kit): b09 5/5,5/5 · y26 5/5,5/5 · y35 4/4,4/4 · b14 2/4,4/4. Dev round 3 ($2.53, kit): b09, y26, y35 all full. The earlier failures on b09, y26, y35 were benchmark coupling, not the model. Dev tasks that still separate: m17, y31 (legacy data), both fixed by the kit
- [x] Final held-out ($12.94): runs passing every hidden test 2/18 no kit vs 8/18 kit; mean 69% vs 81%; cost +36%. Kit wins b14 (3/3 vs 0/3), x23 (2/3 vs 0/3), m19 (2/3 vs 1/3); ties y28; both fail m20, y33 (all-or-nothing edits). PR commit 9b6cdb6, benchmark2/RESULTS.md
- [x] Rewrite weak playbooks for the failures seen: money (refunds across payments), migrations (legacy data, backfill through the project's migrations), new batch-edits
- [x] Run the dev set after each batch (kit arm only) until it beats no-plugin on the dev set (rounds 1-3; final: kit full on all five dev tasks)
- [x] Run `evals/playbook-routing` and the skill-trigger evals on the branch ($2.39): all pass; moonflower-fires missed once, then 3/3 on rerun (the prompt routes to no playbook, so noise)
- [x] Check session-start context did not grow: 14,531 chars on the branch vs 14,151 on main (+380, the longer Playbooks rule); playbook excerpts are injected per request only

## Phase 4: Measure
Acceptance: held-out set, 3 arms x 5 runs on Sonnet (plus a smaller Opus check); report with confidence intervals
- [x] Held-out measured in Phase 3 (no kit vs kit, 3 runs; budget kept it to 6 tasks). Old kit and 5 runs move to the Phase 4b measurement on fresh tasks
- [ ] Opus check: new kit vs no-plugin, 2 runs each (with the Phase 4b measurement, if the owner approves the spend)
- [x] Report for the held-out round: `benchmark2/RESULTS.md` on the PR branch (intervals come with the larger Phase 4b run)

## Phase 4b: Much stronger, and stable in long sessions
Acceptance: the kit beats a plain model by a wider margin on fresh held-out tasks, including multi-request sessions with a forced compaction
- [x] C: playbooks come back after a compaction (re-inject the session's recent playbooks, reset the given-once memory)
- [x] A: before "done", a Stop check turns the used playbooks' edge-case rows into tests the model writes and runs (once per change set)
- [x] B: playbook for all-or-nothing multi-line edits (validate all, one transaction, idempotent resubmit, per-line errors). A, B, C in PR commit after 9b6cdb6
- [x] D: long-session benchmark: 6-8 requests in one session with a forced compaction, hidden tests per request, fresh held-out tasks by the independent author
  - 2026-11-26: author building bench2/sessions/s01-s06 (5-6 requests each, forced /compact, hidden tests per request run together at the end) and tools/run_session.py (claude -p --resume, seals references in /root/.bench2-sealed). Done: 6 sessions x 5 requests, broken/fixed/alt verified, compaction confirmed by compact_boundary events; smoke s01 without the kit passed everything ($0.68). PR commit f36b3bf
- [x] Owner approved the measurement with no budget cap (2026-11-26): results first
- [ ] Long sessions running (bench2/final-sessions, tools/batch_sessions.py, 6 in parallel): Sonnet no kit / new kit / old kit (main) x 5 runs, Opus no kit / new kit x 2 runs, 6 sessions each = 114 session runs. Resumable: finished results are skipped on rerun

## Phase 5: Decide
Acceptance: owner decides merge and whether phases 4-7 of the original Playbooks plan start
- [ ] Brief for the owner with the decision and its numbers

## Notes
- 2026-11-26: 20 tasks in /home/user/bench2 (7 fix, 8 build, 5 feature; 8 dev, 12 held-out). Every hidden test fails on broken and passes on fixed (VERIFY.md); spot-checked b08, f06, m17. Fixed references and hidden tests are moved out (tools/seal.sh) while models run; traces are scanned for reads of bench2 paths.
- 2026-11-26: task author agent started in /home/user/bench2 (outside the kit, never reads Playbooks): 20 tasks, PGlite fixtures, broken/fixed references, dev/held-out split, one offline smoke run. Results go to bench2/VERIFY.md and SPLIT.md; copy into the PR branch as benchmark2/ when verified.
- Diagnosis 2026-11-26 ($3.36): playbooks read in 3 of 18 runs (only h5). Main cause is routing, then strict Haiku rubrics and a Bash allow-list that blocked test runs, then content gaps (CSV BOM, no security domain). Fixes F1-F5 in Plan/2026-11-26-playbooks-diagnosis.md.
- Owner, 2026-11-26: fix everything weak first, then be far stronger than both no-plugin and the old kit, measured by a very strong benchmark focused on complex tasks.
- The first benchmark was written by the same session as the Playbooks; the new tasks must come from an agent that never read them, and the held-out set stays sealed while fixing, so the playbooks are not tuned to the test.
- Bun and PGlite are available in the cloud container.
