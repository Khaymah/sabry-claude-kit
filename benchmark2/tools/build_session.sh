#!/usr/bin/env bash
set -euo pipefail
SESSION_DIR="$1"; KIND="$2"; DEST="$3"
BASE="${BENCH_BASE:-/home/user/bench2/base}"
rm -rf "$DEST"; mkdir -p "$DEST"
cp -R "$BASE"/. "$DEST"/
rm -rf "$DEST/.git"
if [ -d "$SESSION_DIR/reference/broken" ]; then cp -R "$SESSION_DIR/reference/broken"/. "$DEST"/; fi
if [ "$KIND" != broken ]; then cp -R "$SESSION_DIR/reference/$KIND"/. "$DEST"/; fi
