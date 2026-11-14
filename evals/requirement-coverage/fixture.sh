#!/usr/bin/env bash
set -e
git init -q .
cat > package.json <<'JSON'
{ "name": "price", "type": "module", "scripts": { "test": "node --test" } }
JSON
cat > price.mjs <<'JS'
export function total(price, quantity) {
  return price * quantity
}
JS
cat > price.test.mjs <<'JS'
import { test } from "node:test"
import assert from "node:assert/strict"
import { total } from "./price.mjs"

test("total multiplies", () => {
  assert.equal(total(5, 3), 15)
})
JS
git add -A
git -c user.name=fixture -c user.email=fixture@example.com commit -q -m "init"
