#!/usr/bin/env bash
set -euo pipefail
CASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE="${BENCH_BASE:-/home/user/bench2/base}"
DEST="$(pwd)"
if [ ! -r "$BASE/package.json" ] || [ ! -d "$BASE/node_modules" ]; then
  echo "fixture: cannot read the prepared base at $BASE (set BENCH_BASE)" >&2
  exit 1
fi
cp -R "$BASE"/. "$DEST"/
rm -rf "$DEST/.git"
if [ -f "$CASE_DIR/reference/broken.delete" ]; then
  while IFS= read -r P; do
    [ -n "$P" ] && rm -rf "$DEST/$P"
  done < "$CASE_DIR/reference/broken.delete"
fi
if [ -d "$CASE_DIR/reference/broken" ]; then
  cp -R "$CASE_DIR/reference/broken"/. "$DEST"/
fi
