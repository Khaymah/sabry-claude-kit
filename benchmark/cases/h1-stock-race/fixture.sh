#!/usr/bin/env bash
set -euo pipefail
mkdir -p src test
echo '{ "name": "shop", "type": "module", "scripts": { "test": "node --test" } }' > package.json
cat > src/store.mjs <<'J'
const products = new Map()
const delay = () => new Promise((r) => setTimeout(r, Math.random() * 3))
export async function getProduct(id) { await delay(); const p = products.get(id); return p ? { ...p } : null }
export async function saveProduct(p) { await delay(); products.set(p.id, { ...p }) }
export async function addOrder(order) { await delay(); return { id: Math.random().toString(36).slice(2), ...order } }
export function seedProduct(p) { products.set(p.id, { ...p }) }
J
cat > src/shop.mjs <<'J'
import { getProduct, saveProduct, addOrder } from "./store.mjs"

export async function purchase(productId, quantity) {
  const product = await getProduct(productId)
  if (!product) throw new Error("not found")
  if (product.stock < quantity) throw new Error("out of stock")
  product.stock -= quantity
  await saveProduct(product)
  return addOrder({ productId, quantity })
}
J
cat > test/shop.test.mjs <<'J'
import { test } from "node:test"
import assert from "node:assert"
import { purchase } from "../src/shop.mjs"
import { seedProduct } from "../src/store.mjs"

test("buys one", async () => {
  seedProduct({ id: "p1", stock: 3 })
  const order = await purchase("p1", 1)
  assert.equal(order.quantity, 1)
})
J
