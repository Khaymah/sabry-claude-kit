#!/usr/bin/env bash
set -euo pipefail
CASE="$1"
W=/tmp/claude-0/bench_ws/$CASE
for K in broken fixed; do
  bash /home/user/bench2/tools/build_ref.sh "$CASE" "$K" "$W/$K" >/dev/null
  S=$(date +%s)
  R=$(python3 /home/user/bench2/hidden_check.py "$CASE" "$W/$K" 2>"$W/$K.log")
  E=$(( $(date +%s) - S ))
  echo "$CASE $K $R ${E}s"
done
