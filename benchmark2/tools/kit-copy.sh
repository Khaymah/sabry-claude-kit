#!/usr/bin/env bash
set -euo pipefail
SRC=/home/user/sabry-claude-kit/.agents/scratch/pr6; DST=/home/user/kit-under-test
rm -rf "$DST"; mkdir -p "$DST"
git -C "$SRC" stash list >/dev/null
(cd "$SRC" && git ls-files -co --exclude-standard | grep -vE '^(benchmark|benchmark2|evals)/' | tar cf - -T -) | tar xf - -C "$DST"
echo "$DST"
