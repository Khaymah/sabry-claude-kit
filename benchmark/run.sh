#!/usr/bin/env bash
# Full benchmark: baseline (no plugin) vs the previous kit vs this kit.
#   benchmark/run.sh <old-ref> [runs] [model]
# Needs Claude Code >= 2.1.269 with plugin eval, node 20+, and an old ref (default origin/main).
set -euo pipefail
KIT="$(cd "$(dirname "$0")/.." && pwd)"
OLD_REF="${1:-origin/main}"
RUNS="${2:-3}"
MODEL="${3:-sonnet}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/kit-bench-XXXX")"
OUT="$KIT/benchmark/results"
mkdir -p "$OUT/raw"

git -C "$KIT" worktree add -q --detach "$WORK/old" "$OLD_REF"
mkdir -p "$WORK/old/benchmark"
cp -r "$KIT/benchmark/cases" "$WORK/old/benchmark/cases"

COMMON=(--eval-dir benchmark/cases --runs "$RUNS" --scaffold --keep-temp --trust-plugin
        --allow-tools Write Edit "Bash(node *)" --model "$MODEL" --no-publish --threshold 0 -j 4)

python3 "$KIT/benchmark/deterministic.py" --old "$WORK/old" --new "$KIT" --out "$OUT" > "$OUT/raw/deterministic.log" 2>&1

claude plugin eval "$KIT" "${COMMON[@]}" --ablation with-without --max-cost-usd "${NEW_BUDGET:-80}" \
  --json "$OUT/raw/new.json" --output-dir "$OUT/raw/new" || true
claude plugin eval "$WORK/old" "${COMMON[@]}" --ablation none --max-cost-usd "${OLD_BUDGET:-40}" \
  --json "$OUT/raw/old.json" --output-dir "$OUT/raw/old" || true

python3 "$KIT/benchmark/collect.py" --run new="$OUT/raw/new.json" --run old="$OUT/raw/old.json" --out "$OUT" --cleanup
python3 "$KIT/benchmark/report.py" --results "$OUT"

git -C "$KIT" worktree remove --force "$WORK/old"
rm -rf "$WORK"
