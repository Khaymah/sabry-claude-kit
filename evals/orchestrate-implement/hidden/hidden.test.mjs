import { test, beforeEach } from "node:test"
import assert from "node:assert/strict"
const dir = process.env.TARGET
const { applyCoupon, createCoupon, redeem } = await import(dir + "/src/coupons.mjs")
const { clear } = await import(dir + "/src/store.mjs")
const tomorrow = () => new Date(Date.now() + 86400000).toISOString()
const yesterday = () => new Date(Date.now() - 86400000).toISOString()
beforeEach(() => clear())
test("R3 20 concurrent redeems on limit 3", async () => {
  await createCoupon({ code: "L3", type: "fixed", value: 5, expiresAt: tomorrow(), limit: 3 })
  const r = await Promise.allSettled(Array.from({ length: 20 }, () => redeem("L3")))
  assert.equal(r.filter((x) => x.status === "fulfilled").length, 3)
})
test("R3 two coupons do not block each other", async () => {
  await createCoupon({ code: "A", type: "fixed", value: 5, expiresAt: tomorrow(), limit: 1 })
  await createCoupon({ code: "B", type: "fixed", value: 5, expiresAt: tomorrow(), limit: 1 })
  const r = await Promise.allSettled([redeem("A"), redeem("B"), redeem("A"), redeem("B")])
  assert.equal(r.filter((x) => x.status === "fulfilled").length, 2)
})
test("R3 a failed redeem does not jam the next one", async () => {
  await assert.rejects(redeem("NOPE"))
  await createCoupon({ code: "OK", type: "fixed", value: 5, expiresAt: tomorrow(), limit: 1 })
  assert.equal(await redeem("OK"), 1)
})
for (const [name, c] of [["percent 0", { type: "percent", value: 0 }], ["percent 101", { type: "percent", value: 101 }],
  ["fixed 0", { type: "fixed", value: 0 }], ["fixed -5", { type: "fixed", value: -5 }]]) {
  test("R1 rejects " + name, async () => {
    await assert.rejects(createCoupon({ code: "X", ...c, expiresAt: tomorrow(), limit: 1 }))
  })
}
test("R1 rejects past expiry", async () => {
  await assert.rejects(createCoupon({ code: "X", type: "fixed", value: 5, expiresAt: yesterday(), limit: 1 }))
})
test("R1 accepts percent 100 and 1", async () => {
  await createCoupon({ code: "P1", type: "percent", value: 1, expiresAt: tomorrow(), limit: 1 })
  await createCoupon({ code: "P100", type: "percent", value: 100, expiresAt: tomorrow(), limit: 1 })
})
test("R2 floor at zero", async () => {
  await createCoupon({ code: "BIG", type: "fixed", value: 500, expiresAt: tomorrow(), limit: 1 })
  assert.equal(await applyCoupon("BIG", 100), 0)
})
test("R2 rejects a coupon that expired after creation", async () => {
  const soon = new Date(Date.now() + 40).toISOString()
  await createCoupon({ code: "SOON", type: "fixed", value: 5, expiresAt: soon, limit: 1 })
  await new Promise((r) => setTimeout(r, 80))
  await assert.rejects(applyCoupon("SOON", 100))
})
