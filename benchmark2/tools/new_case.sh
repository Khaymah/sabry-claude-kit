#!/usr/bin/env bash
set -euo pipefail
ID="$1"
D=/home/user/bench2/cases/$ID
mkdir -p "$D/hidden" "$D/reference/broken" "$D/reference/fixed" "$D/graders"
cp /home/user/bench2/tools/fixture.sh "$D/fixture.sh"
cp /home/user/bench2/tools/_Support.ts "$D/hidden/_Support.ts"
cat > "$D/case.yaml" <<YAML
schema_version: "1"
name: $ID
context:
  scaffold_script: fixture.sh
YAML
cat > "$D/graders/ran-tests.md" <<'MD'
---
type: tool_used
tool: Bash
input_match: "bun (run )?test"
---
MD
