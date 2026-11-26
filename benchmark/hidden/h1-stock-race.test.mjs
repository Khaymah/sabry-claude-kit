import { test } from "node:test"
import assert from "node:assert"
import { purchase } from "./src/shop.mjs"
import { seedProduct, getProduct } from "./src/store.mjs"

test("20 concurrent buyers never oversell 5 in stock, 5 rounds", async () => {
  for (let round = 0; round < 5; round++) {
    const id = `hidden_${round}`
    seedProduct({ id, stock: 5 })
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => purchase(id, 1)))
    const sold = results.filter((r) => r.status === "fulfilled").length
    assert.equal(sold, 5, `round ${round}: sold ${sold}`)
    assert.equal((await getProduct(id)).stock, 0)
  }
})

test("a buyer asking for more than stock fails", async () => {
  seedProduct({ id: "hidden_big", stock: 2 })
  await assert.rejects(async () => purchase("hidden_big", 3))
})
