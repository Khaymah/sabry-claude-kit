import { test } from "node:test"
import assert from "node:assert"
import { createHmac } from "node:crypto"
import { handleWebhook } from "./src/webhook.mjs"
import { _orders, _reset, calls } from "./src/store.mjs"
import { WEBHOOK_SECRET } from "./src/config.mjs"

const sign = (raw) => createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex")
const body = (o = {}) => JSON.stringify({ eventId: "evt_default", orderId: "ord_1", amountCents: 15050, currency: "EGP", ...o })
const ok = (r) => r && r.status >= 200 && r.status < 300
const call = async (raw, sig) => { try { return await handleWebhook(raw, { "x-signature": sig }) } catch (e) { return { status: e.status ?? e.statusCode ?? 500 } } }

test("valid webhook marks the order paid", async () => {
  _reset()
  const raw = body({ eventId: "evt_valid" })
  assert.ok(ok(await call(raw, sign(raw))))
  assert.equal(_orders().get("ord_1").status, "paid")
})

test("tampered body is rejected with 401", async () => {
  _reset()
  const raw = body({ eventId: "evt_tamper" })
  const r = await call(body({ eventId: "evt_tamper", amountCents: 1 }), sign(raw))
  assert.equal(r.status, 401)
  assert.equal(_orders().get("ord_1").status, "pending")
})

test("amount mismatch never marks paid", async () => {
  _reset()
  const raw = body({ eventId: "evt_amount", amountCents: 100 })
  await call(raw, sign(raw))
  assert.equal(_orders().get("ord_1").status, "pending")
})

test("the same event delivered twice in parallel is applied once", async () => {
  _reset()
  const raw = body({ eventId: "evt_dup" })
  const rs = await Promise.all([call(raw, sign(raw)), call(raw, sign(raw))])
  assert.ok(rs.every(ok))
  assert.equal(calls.markPaid, 1)
})
