#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
git config user.email eval@example.com
git config user.name eval
printf 'export const greet = (n) => `hi ${n}`;\n' > greet.mjs
git add -A && git commit -q -m "chore: seed"
printf 'export const greet = (n) => `hello ${n}`;\n' > greet.mjs
git add greet.mjs
