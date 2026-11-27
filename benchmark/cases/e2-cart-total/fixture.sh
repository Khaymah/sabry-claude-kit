#!/usr/bin/env bash
set -euo pipefail
mkdir -p src test
echo '{ "name": "cart", "type": "module", "scripts": { "test": "node --test" } }' > package.json
echo 'export function calculateTotal(items, { couponPercent } = {}) {}' > src/cart.mjs
