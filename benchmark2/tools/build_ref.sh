#!/usr/bin/env bash
set -euo pipefail
CASE="$1"; KIND="$2"; DEST="$3"
ROOT=/home/user/bench2
CASE_DIR="$ROOT/cases/$CASE"
rm -rf "$DEST"; mkdir -p "$DEST"
(cd "$DEST" && bash "$CASE_DIR/fixture.sh")
if [ "$KIND" = fixed ] || [ "$KIND" = alt ]; then
  if [ -f "$CASE_DIR/reference/fixed.delete" ]; then
    while IFS= read -r P; do [ -n "$P" ] && rm -rf "$DEST/$P"; done < "$CASE_DIR/reference/fixed.delete"
  fi
  cp -R "$CASE_DIR/reference/$KIND"/. "$DEST"/
fi
