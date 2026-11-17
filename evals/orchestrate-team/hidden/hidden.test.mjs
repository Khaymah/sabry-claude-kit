import { test, beforeEach } from "node:test"
import assert from "node:assert/strict"
const dir = process.env.TARGET
const { handle } = await import(dir + "/src/router.mjs")
const { reset } = await import(dir + "/src/store.mjs")
const { renderOrders } = await import(dir + "/public/app.js")
const as = (t) => ({ authorization: "Bearer " + t })
const post = (t, body) => handle({ method: "POST", path: "/orders", headers: as(t), body })
const get = (t, path, query) => handle({ method: "GET", path, headers: as(t), query })
const order = (t, productId = "p2", quantity = 1, note) => post(t, { items: [{ productId, quantity }], note })
beforeEach(() => reset())

test("R1 another customer's order is 404", async () => {
  const o = await order("t-alice")
  assert.equal((await get("t-bob", "/orders/" + o.body.id)).status, 404)
})
test("R1 owner and admin can read it", async () => {
  const o = await order("t-alice")
  assert.equal((await get("t-alice", "/orders/" + o.body.id)).status, 200)
  assert.equal((await get("t-admin", "/orders/" + o.body.id)).status, 200)
})
for (const [name, body] of [
  ["empty items", { items: [] }], ["items not array", { items: "p1" }], ["missing items", {}],
  ["quantity 0", { items: [{ productId: "p2", quantity: 0 }] }],
  ["quantity 101", { items: [{ productId: "p2", quantity: 101 }] }],
  ["quantity 1.5", { items: [{ productId: "p2", quantity: 1.5 }] }],
  ["quantity string", { items: [{ productId: "p2", quantity: "2" }] }],
  ["unknown product", { items: [{ productId: "nope", quantity: 1 }] }]]) {
  test("R2 400 on " + name, async () => {
    const res = await post("t-alice", body)
    assert.equal(res.status, 400)
    assert.ok(res.body && res.body.error && res.body.fields, "error and fields")
  })
}
test("R2 a missing body is 400, not a crash", async () => {
  assert.equal((await post("t-alice", undefined)).status, 400)
})
test("R2 rejected order reserves nothing", async () => {
  await post("t-alice", { items: [{ productId: "p1", quantity: 2 }, { productId: "nope", quantity: 1 }] })
  assert.equal((await get("t-alice", "/products/p1")).body.stock, 5)
})
test("R3 out of stock is 409", async () => {
  assert.equal((await order("t-alice", "p3", 1)).status, 409)
})
test("R3 20 concurrent orders on stock 5", async () => {
  const res = await Promise.all(Array.from({ length: 20 }, () => order("t-alice", "p1", 1)))
  assert.equal(res.filter((r) => r.status === 201).length, 5)
  assert.equal(res.filter((r) => r.status === 409).length, 15)
  assert.equal((await get("t-alice", "/products/p1")).body.stock, 0)
})
test("R3 a multi-item order that fails on its second item releases the first", async () => {
  const res = await post("t-alice", { items: [{ productId: "p1", quantity: 2 }, { productId: "p3", quantity: 1 }] })
  assert.equal(res.status, 409)
  assert.equal((await get("t-alice", "/products/p1")).body.stock, 5)
})
test("R4 page 1 is the first page, default size 10", async () => {
  for (let i = 0; i < 12; i++) await order("t-alice")
  const res = await get("t-alice", "/orders", {})
  assert.equal(res.body.items.length, 10)
  assert.equal(res.body.total, 12)
  assert.equal(res.body.page, 1)
  assert.equal((await get("t-alice", "/orders", { page: 2 })).body.items.length, 2)
})
test("R4 pageSize is capped at 50", async () => {
  for (let i = 0; i < 60; i++) await order("t-alice")
  const res = await get("t-alice", "/orders", { pageSize: 500 })
  assert.equal(res.body.items.length, 50)
  assert.equal(res.body.pageSize, 50)
})
test("R4 customers see their own, admin sees all", async () => {
  await order("t-alice"); await order("t-bob")
  assert.equal((await get("t-alice", "/orders", {})).body.total, 1)
  assert.equal((await get("t-admin", "/orders", {})).body.total, 2)
})
test("R4 bad paging input does not crash or go negative", async () => {
  await order("t-alice")
  for (const q of [{ page: 0 }, { page: -3 }, { page: "abc" }, { pageSize: 0 }, { pageSize: -1 }]) {
    const res = await get("t-alice", "/orders", q)
    assert.ok(res.status === 200 || res.status === 400, JSON.stringify(q))
    if (res.status === 200) assert.ok(res.body.items.length <= 1 && res.body.page >= 1 && res.body.pageSize >= 1, JSON.stringify(q))
  }
})
test("R5 integer cents, no float fields", async () => {
  const o = await order("t-alice", "p2", 3)
  assert.equal(o.body.totalCents, 30)
  assert.ok(!("total" in o.body))
  const p = await get("t-alice", "/products/p1")
  assert.equal(p.body.priceCents, 1999)
  assert.ok(!("price" in p.body))
  const mixed = await post("t-alice", { items: [{ productId: "p1", quantity: 3 }, { productId: "p2", quantity: 7 }] })
  assert.equal(mixed.body.totalCents, 6067)
})
test("R6 note is escaped and total formatted", async () => {
  const html = renderOrders([{ id: "o1", totalCents: 1234, note: '<img src=x onerror=alert(1)> & "q"' }])
  assert.ok(!html.includes("<img"), "raw tag")
  assert.ok(html.includes("&lt;img"))
  assert.ok(html.includes("&amp;"))
  assert.ok(html.includes("12.34"))
  assert.ok(renderOrders([{ id: "o2", totalCents: 5, note: "" }]).includes("0.05"))
})
test("R6 order id is escaped too", async () => {
  assert.ok(!renderOrders([{ id: "<b>x</b>", totalCents: 1, note: "" }]).includes("<b>x</b>"))
})
test("contract kept: 401 without token, 201 shape", async () => {
  assert.equal((await handle({ method: "GET", path: "/orders", headers: {} })).status, 401)
  const o = await order("t-alice", "p2", 1, "hi")
  assert.deepEqual(Object.keys(o.body).sort(), ["id", "items", "note", "status", "totalCents", "userId"])
})
