#!/usr/bin/env bash
set -euo pipefail
mkdir -p src test
echo '{ "name": "admin", "type": "module", "scripts": { "test": "node --test" } }' > package.json
cat > src/db.mjs <<'J'
export const stats = { queries: 0 }
const tables = { orders: [], customers: [], items: [] }
const delay = () => new Promise((r) => setTimeout(r, 2))
const matches = (row, where) => Object.entries(where).every(([k, v]) => (Array.isArray(v) ? v.includes(row[k]) : row[k] === v))
export async function query(table, where = {}) { stats.queries++; await delay(); return tables[table].filter((r) => matches(r, where)).map((r) => ({ ...r })) }
export function seed(table, rows) { tables[table].push(...rows.map((r) => ({ ...r }))) }
export function reset() { for (const k of Object.keys(tables)) tables[k] = []; stats.queries = 0 }
J
cat > src/orders.mjs <<'J'
import { query } from "./db.mjs"

export async function listOrdersPage(status) {
  const orders = await query("orders", { status })
  const result = []
  for (const order of orders) {
    const [customer] = await query("customers", { id: order.customerId })
    const items = await query("items", { orderId: order.id })
    result.push({ ...order, customerName: customer ? customer.name : null, itemCount: items.length })
  }
  return result
}
J
cat > test/orders.test.mjs <<'J'
import { test } from "node:test"
import assert from "node:assert"
import { listOrdersPage } from "../src/orders.mjs"
import { seed, reset } from "../src/db.mjs"

test("lists paid orders with customer names", async () => {
  reset()
  seed("customers", [{ id: "c1", name: "منى" }])
  seed("orders", [{ id: "o1", customerId: "c1", status: "paid" }])
  seed("items", [{ id: "i1", orderId: "o1" }, { id: "i2", orderId: "o1" }])
  const rows = await listOrdersPage("paid")
  assert.deepEqual(rows, [{ id: "o1", customerId: "c1", status: "paid", customerName: "منى", itemCount: 2 }])
})
J
