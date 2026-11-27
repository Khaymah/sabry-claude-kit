# benchmark2 results (2026-11-26, Sonnet)

Held-out tasks, never seen while the playbooks were tuned. 3 runs per task per setup. Score = share of hidden tests passed.

| Task | No kit | Kit (Playbooks) |
|---|---|---|
| b14 customer report at volume | 2/4 · 2/4 · 2/4 | **4/4 · 4/4 · 4/4** |
| m19 card checkout | 4/6 · 6/6 · 4/6 | 4/6 · **6/6 · 6/6** |
| x23 expenses import and export | 4/5 · 4/5 · 4/5 | **5/5 · 5/5** · 4/5 |
| y28 checkout webhook race | 1/5 · 5/5 · 1/5 | 1/5 · 1/5 · 5/5 |
| m20 order edit bounds | 4/5 × 3 | 4/5 × 3 |
| y33 stock adjust rollback | 4/5 × 3 | 4/5 × 3 |
| **Runs passing every hidden test** | **2 of 18 (11%)** | **8 of 18 (44%)** |
| **Mean hidden tests passed** | **69%** | **81%** |
| Cost (18 runs) | $5.48 | $7.46 (+36%) |

Dev tasks (used while tuning), final state: the kit passes every hidden test on b09, m17, y26, y31, y35 (2 runs each); without the kit m17 and y31 fail once each.

Limits:
- 3 runs per task: a single run moves a task by a third.
- The held-out tasks were kept because the plain model failed them in the pilot, which favours any second setup a little (regression to the mean).
- Six tasks; m20 and y33 (all-or-nothing edits) are unsolved by both setups.
- The routing table was not tuned on held-out prompts, but their routing output was printed once during diagnosis.

## Long sessions

Six sessions of five requests on one codebase, `/compact` after requests 2 and 4, hidden tests re-run on every earlier request after each one. Every run compacted twice; no reference leaked.

| Setup | Sessions passing every check | Requests passing every check | Mean checks passed | Cost per session |
|---|---|---|---|---|
| Sonnet, no kit (30) | 20 | 130/150 | 94.7% | $0.78 |
| Sonnet, old kit `main` (30) | 19 | 132/150 | 95.7% | $0.99 |
| Sonnet, new kit (30) | 21 | 133/150 | 95.7% | $1.15 |
| Opus, no kit (12) | 9 | 55/60 | 96.7% | $2.13 |
| Opus, new kit (12) | 10 | 56/60 | 97.5% | $2.68 |

Four of the six sessions score the same in every setup (ceiling). The only session that separates is s03, where Sonnet without the kit drops to 9 of 14 checks in two runs of five; both kits stay at 12 or more. The differences between setups are within one run's noise.

Correction after the run: s02 r01 and r02 lost one check in every run of every setup because the hidden test required `200` where the new endpoint creates a receipt and correctly answers `201`. The test now accepts both (re-verified: broken fails, fixed and alt pass). The failure hit all setups equally, so the comparison stands; with it removed, five of the six sessions score the same in every setup.

Raw rows: `results/`. Method and history: `Plan/2026-11-26-playbooks-strong-plan.md` and `Plan/2026-11-26-playbooks-diagnosis.md` on `main`.

## Hard long sessions

Four sessions (h01 multi-branch warehouse, h02 subscriptions and billing, h03 staff and branch permissions, h04 credit accounts with owner corrections), 8 requests each, `/compact` after requests 2, 4 and 6. The hidden tests of every request run at the end, so a later request that breaks an earlier one is counted. 76 runs. A request passes when all its hidden tests pass.

| Setup | Runs | Sessions fully passed | Requests passed | Tests passed | Cost per session |
|---|---|---|---|---|---|
| Sonnet, no kit | 20 | 7 | 69.4% | 89.5% | $1.80 |
| Sonnet, kit 0.3.1 (main) | 20 | 9 | 72.5% | 91.3% | $2.15 |
| Sonnet, this kit | 20 | 13 | 88.1% | 96.4% | $2.87 |
| Opus, no kit | 8 | 6 | 95.3% | 98.2% | $5.76 |
| Opus, this kit | 8 | 4 | 87.5% | 96.4% | $7.34 |

Requests passed per session:

| Setup | h01 | h02 | h03 | h04 |
|---|---|---|---|---|
| Sonnet, no kit | 24/40 | 35/40 | 12/40 | 40/40 |
| Sonnet, kit 0.3.1 | 27/40 | 37/40 | 12/40 | 40/40 |
| Sonnet, this kit | 39/40 | 40/40 | 23/40 | 39/40 |
| Opus, no kit | 15/16 | 14/16 | 16/16 | 16/16 |
| Opus, this kit | 15/16 | 10/16 | 15/16 | 16/16 |

- With Sonnet the kit lifts requests passed from 69% to 88%; the gain is in branch scoping (h03) and atomic multi-branch stock changes (h01). The old kit is close to no kit.
- With Opus the kit does not help here: both kit runs fail the same h02 requests (r04, r06, r07), which points to a playbook default (`backend/data/money.md`: amounts as strings, half-up rounding) overriding the project's own conventions and the owner's stated rule. Two runs per setup, so the Opus numbers are weaker evidence than the Sonnet ones.
- Sonnet with this kit reaches 88% at half the cost of Opus without the kit (95%).
- Fairness: the base `ParseId` let ids above int32 reach the database; each hard session's broken overlay bounds it so reusing the house helper is not punished. Huge-id tests are close to what the kit teaches, so they may favour it slightly.

## Held-out long sessions

Three sessions written by a builder that never saw the kit: x01 payroll (8 requests), x02 sales quotes (8 requests), x03 support ticketing (12 requests, `/compact` after requests 2, 4, 6, 8 and 10). No playbook was written for them. Reference check: broken fails every request, fixed and alt pass every request, typecheck clean. Five runs per setup, 60 runs. The kit under test has 122 playbooks, the precedence rule (owner, then project code, then playbook) and the lean excerpt for strong models.

| Setup | Runs | Sessions fully passed | Requests passed | Tests passed | Cost per session |
|---|---|---|---|---|---|
| Sonnet, no kit | 15 | 5 | 82.9% | 93.9% | $2.35 |
| Sonnet, this kit | 15 | 12 | 92.9% | 93.9% | $3.45 |
| Opus, no kit | 15 | 13 | 96.4% | 98.6% | $7.15 |
| Opus, this kit | 15 | 14 | 98.6% | 99.3% | $8.02 |

Requests passed per session:

| Setup | x01 | x02 | x03 |
|---|---|---|---|
| Sonnet, no kit | 36/40 | 33/40 | 47/60 |
| Sonnet, this kit | 40/40 | 31/40 | 59/60 |
| Opus, no kit | 40/40 | 40/40 | 55/60 |
| Opus, this kit | 40/40 | 40/40 | 58/60 |

- Sonnet with the kit fully passes 12 of 15 sessions against 5 of 15 without it (Fisher p = 0.025). The largest gain is the 12-request session x03 (47/60 to 59/60).
- One Sonnet-with-kit run (x02 r3) fails all 8 requests: the app no longer started. In that run the model edited the schema through scripts and never ran the tests. It counts as a failure. The other 14 runs lose 2 requests in total; without that run the rate would be 98.5%.
- Opus with the kit is at or above Opus without it on every session (98.6% vs 96.4%), at 12% more cost. The earlier Opus loss on h02 did not repeat: a rerun of h02 passed 8/8 twice, so it was variance at two runs.
- Sonnet with the kit against Opus without it: 92.9% vs 96.4% of requests, 12 vs 13 sessions fully passed, at 48% of the cost. The gap is not significant at 15 runs (p = 1.0 on sessions fully passed).
- Fairness: the harness refuses some Bash forms (heredocs to `python3`, compound commands) in every setup alike, 3 to 14 times per run, with no difference between arms.

### Follow-up: verify-reminder fix on x02

The failed run above edited code through Bash scripts, took one refused Bash form as "Bash is off" and never ran a test. `verify-reminder` missed it: Bash writes did not count as edits, `sed -n 1p a.test.ts` counted as a check, "not run" in the reply silenced it, and it only added context. Now Bash writes count, only checker commands count, a refusal does not excuse skipping checks, and it blocks the stop once per change set. Replayed on the failed run's transcript, the old hook stayed silent and the new one blocks.

Sonnet with the kit on x02, five new runs: 35/40 requests (87.5%), 2 of 5 sessions fully passed, $3.08 per session, no run where the app stopped starting. The hook fired in two runs; in both the model then ran `bun run typecheck` and `bun run test` as plain commands and corrected its report. The requests still lost are logic errors its own tests did not catch. Before the fix: 31/40 with the kit, 33/40 without it, so x02 stays noisy for Sonnet at five runs.
