import { test } from "node:test"
import assert from "node:assert"
import { seed, stats } from "./src/db.mjs"
import { exportOrdersCsv } from "./src/export.mjs"

const run = async () => {
  const rows = []
  for (let i = 0; i < 2500; i++) rows.push({ id: `o${String(i).padStart(5, "0")}`, customerName: i === 7 ? "=HYPERLINK(\"http://x\")" : i === 8 ? "Ali, \"Jr\"" : `عميل ${i}`, totalCents: 1000 + i, currency: "EGP", createdAt: "2026-01-01T10:00:00Z" })
  seed(rows)
  const chunks = []
  await exportOrdersCsv((c) => { chunks.push(String(c)) })
  return chunks.join("")
}

test("UTF-8 BOM for Excel", async () => { assert.ok((await run()).startsWith("﻿")) })
test("reads in bounded batches", async () => { await run(); assert.ok(stats.maxRows <= 5000 && stats.queries > 1, `maxRows ${stats.maxRows} queries ${stats.queries}`) })
test("formula cell is neutralised", async () => { const csv = await run(); assert.ok(!/(^|,)"?=HYPERLINK/m.test(csv)) })
test("every Arabic name exported", async () => { const csv = await run(); assert.ok(csv.includes("عميل 2499") && csv.includes("عميل 0")) })
