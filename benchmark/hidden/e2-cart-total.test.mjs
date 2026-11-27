import { test } from "node:test"
import assert from "node:assert"
import { calculateTotal } from "./src/cart.mjs"
import { minor } from "./_util.mjs"

const totalOf = (r) => minor(r.total ?? r.Total ?? r.totalMinor ?? r.TotalMinor)

test("0.10 + 0.20 with 14% tax is exactly 0.34", async () => {
  const r = await calculateTotal([{ price: "0.10", quantity: 1 }, { price: "0.20", quantity: 1 }], {})
  assert.equal(totalOf(r), 34)
  assert.ok(!/\d\.\d{3,}/.test(JSON.stringify(r, (_, v) => (typeof v === "bigint" ? v.toString() : v))), "float artefacts in output")
})

test("rejects a price with three decimals", async () => {
  await assert.rejects(async () => calculateTotal([{ price: "1.999", quantity: 1 }], {}))
})

test("rejects a coupon above 100%", async () => {
  await assert.rejects(async () => calculateTotal([{ price: "10.00", quantity: 1 }], { couponPercent: 150 }))
})

test("rejects a negative quantity", async () => {
  await assert.rejects(async () => calculateTotal([{ price: "10.00", quantity: -2 }], {}))
})
