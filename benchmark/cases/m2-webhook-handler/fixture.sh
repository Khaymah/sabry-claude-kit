#!/usr/bin/env bash
set -euo pipefail
mkdir -p src test
echo '{ "name": "pay", "type": "module", "scripts": { "test": "node --test" } }' > package.json
echo 'export const WEBHOOK_SECRET = "whsec_test_123"' > src/config.mjs
cat > src/store.mjs <<'J'
const orders = new Map([["ord_1", { id: "ord_1", totalCents: 15050, currency: "EGP", status: "pending" }]])
const delay = () => new Promise((r) => setTimeout(r, 1))
export async function getOrder(id) { await delay(); const o = orders.get(id); return o ? { ...o } : null }
export async function markPaid(id) { await delay(); const o = orders.get(id); if (o) o.status = "paid" }
export function _orders() { return orders }
J
echo 'export async function handleWebhook(rawBody, headers) {}' > src/webhook.mjs
