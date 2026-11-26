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

Raw rows: `results/`. Method and history: `Plan/2026-11-26-playbooks-strong-plan.md` and `Plan/2026-11-26-playbooks-diagnosis.md` on `main`.
