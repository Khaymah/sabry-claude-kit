import { test } from "node:test"
import assert from "node:assert"
import { seed, reset, stats } from "./src/db.mjs"
import { listOrdersPage } from "./src/orders.mjs"

const fill = (n) => {
  reset()
  seed("customers", Array.from({ length: 50 }, (_, i) => ({ id: `c${i}`, name: `عميل ${i}` })))
  seed("orders", Array.from({ length: n }, (_, i) => ({ id: `o${i}`, customerId: i % 7 === 0 ? "missing" : `c${i % 50}`, status: "paid" })))
  seed("items", Array.from({ length: n * 2 }, (_, i) => ({ id: `i${i}`, orderId: `o${i % n}` })).filter((_, i) => i % 5 !== 0))
}

test("constant number of queries for 300 orders", async () => {
  fill(300)
  await listOrdersPage("paid")
  assert.ok(stats.queries <= 5, `${stats.queries} queries`)
})

test("same shape as before, including missing customer and zero items", async () => {
  fill(20)
  const rows = await listOrdersPage("paid")
  const o0 = rows.find((r) => r.id === "o0")
  assert.equal(rows.length, 20)
  assert.equal(o0.customerName, null)
  assert.equal(typeof o0.itemCount, "number")
  assert.deepEqual(Object.keys(o0).sort(), ["customerId", "customerName", "id", "itemCount", "status"])
})
