#!/usr/bin/env bash
set -euo pipefail
B=/home/user/bench2; V=/home/user/.bench2-vault
if [ "${1:-}" = "seal" ]; then
  mkdir -p "$V"
  for c in "$B"/cases/*/; do n=$(basename "$c"); mkdir -p "$V/$n"
    [ -d "$c/reference/fixed" ] && mv "$c/reference/fixed" "$V/$n/fixed"
    [ -d "$c/hidden" ] && mv "$c/hidden" "$V/$n/hidden"; done
else
  for d in "$V"/*/; do n=$(basename "$d")
    [ -d "$d/fixed" ] && mv "$d/fixed" "$B/cases/$n/reference/fixed"
    [ -d "$d/hidden" ] && mv "$d/hidden" "$B/cases/$n/hidden"; done
  rm -rf "$V"
fi
