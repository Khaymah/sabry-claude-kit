#!/usr/bin/env bash
set -euo pipefail
mkdir -p src test
echo '{ "name": "exp", "type": "module", "scripts": { "test": "node --test" } }' > package.json
cat > src/db.mjs <<'J'
export const stats = { queries: 0, maxRows: 0 }
let orders = []
const delay = () => new Promise((r) => setTimeout(r, 1))
export async function query(table, { orderBy = "id", afterId, limit } = {}) {
  stats.queries++
  await delay()
  let rows = [...orders].sort((a, b) => (a[orderBy] < b[orderBy] ? -1 : 1))
  if (afterId) rows = rows.filter((r) => r.id > afterId)
  const out = limit ? rows.slice(0, limit) : rows
  stats.maxRows = Math.max(stats.maxRows, out.length)
  return out.map((r) => ({ ...r }))
}
export function seed(rows) { orders = rows.map((r) => ({ ...r })) }
J
echo 'export async function exportOrdersCsv(write) {}' > src/export.mjs
