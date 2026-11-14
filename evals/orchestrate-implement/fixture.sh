#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
git config user.email eval@example.com
git config user.name eval
mkdir -p src test
cat > package.json <<'JSON'
{ "name": "coupons", "type": "module", "scripts": { "test": "node --test" } }
JSON
cat > src/store.mjs <<'JS'
const coupons = new Map()

const delay = () => new Promise((resolve) => setTimeout(resolve, 1))

export async function save(coupon) {
  await delay()
  coupons.set(coupon.code, { ...coupon })
}

export async function load(code) {
  await delay()
  const found = coupons.get(code)
  return found ? { ...found } : null
}

export function clear() {
  coupons.clear()
}
JS
cat > src/coupons.mjs <<'JS'
import { load, save } from "./store.mjs"

export async function createCoupon({ code, type, value, expiresAt, limit }) {
  const coupon = { code, type, value, expiresAt, limit, used: 0 }
  await save(coupon)
  return coupon
}

export async function applyCoupon(code, total) {
  const coupon = await load(code)
  if (!coupon) throw new Error("coupon not found")
  if (coupon.type === "percent") return total - (total * coupon.value) / 100
  return total - coupon.value
}

export async function redeem(code) {
  const coupon = await load(code)
  if (!coupon) throw new Error("coupon not found")
  if (coupon.used >= coupon.limit) throw new Error("coupon limit reached")
  coupon.used += 1
  await save(coupon)
  return coupon.used
}
JS
cat > test/coupons.test.mjs <<'JS'
import { test, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { applyCoupon, createCoupon, redeem } from "../src/coupons.mjs"
import { clear } from "../src/store.mjs"

const tomorrow = () => new Date(Date.now() + 86400000).toISOString()

beforeEach(() => clear())

test("percent coupon reduces the total", async () => {
  await createCoupon({ code: "TEN", type: "percent", value: 10, expiresAt: tomorrow(), limit: 5 })
  assert.equal(await applyCoupon("TEN", 200), 180)
})

test("redeem counts uses", async () => {
  await createCoupon({ code: "ONE", type: "fixed", value: 5, expiresAt: tomorrow(), limit: 2 })
  assert.equal(await redeem("ONE"), 1)
  assert.equal(await redeem("ONE"), 2)
})
JS
git add -A && git commit -q -m "chore: seed"
