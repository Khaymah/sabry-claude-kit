#!/usr/bin/env bash
set -euo pipefail
S="$1"
D=/home/user/bench2/sessions/$S
for K in ${2:-broken fixed alt}; do
  W=/tmp/claude-0/sess_ws/$S/$K
  bash /home/user/bench2/tools/build_session.sh "$D" "$K" "$W"
  R=$(python3 /home/user/bench2/tools/session_check.py "$D/hidden" "$W" 2>"$W.log")
  echo "$S $K $R"
done
