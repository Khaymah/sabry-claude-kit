# benchmark2: hard backend tasks on Bun + Hono + Drizzle + PGlite

Written by an agent that never read `Playbooks/`, so it can test them. 20 tasks (7 fix, 8 build, 5 multi-module features), each with hidden tests that fail on `reference/broken` and pass on `reference/fixed` (`VERIFY.md`), split into 8 dev and 12 held-out tasks (`SPLIT.md`).

## Setup

The fixtures copy a prepared base with its `node_modules` from `/home/user/bench2/base` (the eval sandbox runs offline and does not pass `BENCH_BASE` through):

    mkdir -p /home/user/bench2 && cp -R benchmark2/. /home/user/bench2/
    cd /home/user/bench2/base && bun install

## Run

- `tools/pilot.sh`: every task without the kit, `RUNS` runs each (default 2), then the hidden tests. Fixed references and hidden tests are moved out of reach while the model runs (`tools/seal.sh`).
- `hidden_check.py <case> <workspace>`: the hidden tests against one workspace.

## Status

Pilot 2026-11-26, Sonnet without the kit, 2 runs per task: 39 of 40 runs passed every hidden test (`pilot-no-plugin.json`). The tasks state their problem too clearly to separate a strong setup from a plain one; see `Plan/2026-11-26-playbooks-strong-plan.md` on `main`.
