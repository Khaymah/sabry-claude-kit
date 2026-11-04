#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
git config user.email eval@example.com
git config user.name eval
cat > package.json <<'EOF'
{ "name": "calc", "type": "module", "scripts": { "test": "node --test" } }
EOF
cat > sum.mjs <<'EOF'
export function sum(a, b) {
  return a - b;
}
EOF
cat > sum.test.mjs <<'EOF'
import { test } from "node:test";
import assert from "node:assert";
import { sum } from "./sum.mjs";
test("adds", () => assert.equal(sum(2, 3), 5));
EOF
git add -A && git commit -q -m "chore: seed"
