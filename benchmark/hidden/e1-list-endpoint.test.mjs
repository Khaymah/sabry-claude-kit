import { test } from "node:test"
import assert from "node:assert"
import { seed, reset, stats } from "./src/db.mjs"
import { listCustomerOrders } from "./src/orders.mjs"
import { firstArray } from "./_util.mjs"

const big = () => {
  reset()
  const rows = []
  for (let i = 0; i < 1500; i++) rows.push({ id: `o${String(i).padStart(5, "0")}`, customerId: "c1", total: 100, createdAt: `2026-01-${String((i % 28) + 1).padStart(2, "0")}T10:00:00Z`, status: "paid" })
  rows.push({ id: "x1", customerId: "c2", total: 1, createdAt: "2026-01-01T10:00:00Z", status: "paid" })
  seed("orders", rows)
}

test("a requested limit of 1000 is capped", async () => {
  big()
  const page = firstArray(await listCustomerOrders("c1", { limit: 1000 }))
  assert.ok(page && page.length > 0 && page.length <= 200)
})

test("never loads more rows than a page from the database", async () => {
  big()
  await listCustomerOrders("c1", {})
  assert.ok(stats.maxReturned <= 201, `loaded ${stats.maxReturned} rows`)
})

test("only the customer's own orders", async () => {
  big()
  const page = firstArray(await listCustomerOrders("c2", {}))
  assert.deepEqual(page.map((o) => o.id), ["x1"])
})
