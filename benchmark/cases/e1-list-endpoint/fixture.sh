#!/usr/bin/env bash
set -euo pipefail
mkdir -p src test
cat > package.json <<'J'
{ "name": "shop", "type": "module", "scripts": { "test": "node --test" } }
J
cat > src/db.mjs <<'J'
export const stats = { queries: 0 }
const tables = { orders: [], customers: [] }
const delay = () => new Promise((r) => setTimeout(r, 1))
const matches = (row, where) => Object.entries(where).every(([k, v]) => (Array.isArray(v) ? v.includes(row[k]) : row[k] === v))
export async function query(table, { where = {}, orderBy = [], limit, after } = {}) {
  stats.queries++
  await delay()
  let rows = tables[table].filter((r) => matches(r, where))
  for (const [col, dir] of [...orderBy].reverse()) rows = [...rows].sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (dir === "desc" ? -1 : 1))
  if (after) rows = rows.filter(after)
  return (limit ? rows.slice(0, limit) : rows).map((r) => ({ ...r }))
}
export function seed(table, rows) { tables[table].push(...rows.map((r) => ({ ...r }))) }
export function reset() { for (const k of Object.keys(tables)) tables[k] = []; stats.queries = 0 }
J
cat > src/orders.mjs <<'J'
import { query } from "./db.mjs"
J
