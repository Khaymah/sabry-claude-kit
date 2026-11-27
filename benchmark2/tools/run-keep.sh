#!/usr/bin/env bash
set -uo pipefail
OUT=$1; shift
mkdir -p "$OUT/keep"
( while [ ! -f "$OUT/done" ]; do for d in /tmp/claude-eval-*; do [ -f "$d/out/trace.jsonl" ] || continue; n=$(basename $d); mkdir -p "$OUT/keep/$n"; cp "$d/out/trace.jsonl" "$OUT/keep/$n/" 2>/dev/null; (cd "$d/home" 2>/dev/null && tar cf - --exclude=node_modules cwd 2>/dev/null) | tar xf - -C "$OUT/keep/$n" 2>/dev/null; done; sleep 10; done ) &
W=$!
env OUT_DIR="$OUT" "$@" /home/user/bench2/tools/pilot.sh
touch "$OUT/done"; wait $W
