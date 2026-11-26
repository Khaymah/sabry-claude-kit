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
