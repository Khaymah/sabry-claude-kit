#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
git config user.email eval@example.com
git config user.name eval
mkdir -p src public test docs
cat > package.json <<'EOF'
{ "name": "orders-service", "type": "module", "scripts": { "test": "node --test" } }
EOF
cat > docs/contract.md <<'EOF'
# Orders service contract

Everything goes through `handle(request)` in `src/router.mjs`:

    request  = { method, path, query, headers, body }
    response = { status, body }

Auth: `headers.authorization = "Bearer <token>"`. Tokens: `t-alice`, `t-bob` (customers), `t-admin` (admin). No or unknown token: 401.

| Route | Result |
|---|---|
| `POST /orders` body `{ items: [{ productId, quantity }], note }` | 201 `{ id, userId, items, totalCents, note, status }` |
| `GET /orders/:id` | 200 the order |
| `GET /orders` query `{ page, pageSize }` | 200 `{ items, total, page, pageSize }` |
| `GET /products/:id` | 200 `{ id, name, priceCents, stock }` |

`renderOrders(orders)` in `public/app.js` returns the HTML string for the orders list.
`reset()` in `src/store.mjs` restores the seed data (products `p1` stock 5, `p2` stock 100, `p3` stock 0).
EOF
cat > src/store.mjs <<'EOF'
const seed = () => ({
  products: new Map([
    ["p1", { id: "p1", name: "Keyboard", price: 19.99, stock: 5 }],
    ["p2", { id: "p2", name: "Cable", price: 0.1, stock: 100 }],
    ["p3", { id: "p3", name: "Monitor", price: 149.5, stock: 0 }],
  ]),
  orders: new Map(),
  nextId: 1,
})

let data = seed()

const delay = () => new Promise((resolve) => setTimeout(resolve, 1))

export function reset() {
  data = seed()
}

export async function getProduct(id) {
  await delay()
  const found = data.products.get(id)
  return found ? { ...found } : null
}

export async function saveProduct(product) {
  await delay()
  data.products.set(product.id, { ...product })
}

export async function insertOrder(order) {
  await delay()
  const id = "o" + data.nextId++
  const saved = { ...order, id }
  data.orders.set(id, saved)
  return { ...saved }
}

export async function getOrder(id) {
  await delay()
  const found = data.orders.get(id)
  return found ? { ...found } : null
}

export async function allOrders() {
  await delay()
  return [...data.orders.values()].map((o) => ({ ...o }))
}
EOF
cat > src/auth.mjs <<'EOF'
const users = {
  "t-alice": { id: "alice", role: "customer" },
  "t-bob": { id: "bob", role: "customer" },
  "t-admin": { id: "admin", role: "admin" },
}

export function userFromHeaders(headers) {
  const value = (headers && headers.authorization) || ""
  const token = value.replace("Bearer ", "")
  return users[token] || null
}
EOF
cat > src/inventory.mjs <<'EOF'
import { getProduct, saveProduct } from "./store.mjs"

export async function reserve(productId, quantity) {
  const product = await getProduct(productId)
  if (product.stock < quantity) throw new Error("out of stock")
  product.stock -= quantity
  await saveProduct(product)
}
EOF
cat > src/orders.mjs <<'EOF'
import { allOrders, getOrder, getProduct, insertOrder } from "./store.mjs"
import { reserve } from "./inventory.mjs"

export async function createOrder(user, body) {
  let total = 0
  for (const item of body.items) {
    const product = await getProduct(item.productId)
    await reserve(item.productId, item.quantity)
    total += product.price * item.quantity
  }
  return insertOrder({ userId: user.id, items: body.items, total, note: body.note || "", status: "placed" })
}

export async function findOrder(user, id) {
  return getOrder(id)
}

export async function listOrders(user, query) {
  const page = Number(query.page || 1)
  const pageSize = Number(query.pageSize || 10)
  const mine = (await allOrders()).filter((o) => o.userId === user.id)
  const start = page * pageSize
  return { items: mine.slice(start, start + pageSize), total: mine.length, page, pageSize }
}
EOF
cat > src/router.mjs <<'EOF'
import { userFromHeaders } from "./auth.mjs"
import { createOrder, findOrder, listOrders } from "./orders.mjs"
import { getProduct } from "./store.mjs"

export async function handle(request) {
  const user = userFromHeaders(request.headers)
  if (!user) return { status: 401, body: { error: "unauthorized" } }
  const { method, path } = request
  if (method === "POST" && path === "/orders") {
    return { status: 201, body: await createOrder(user, request.body) }
  }
  if (method === "GET" && path === "/orders") {
    return { status: 200, body: await listOrders(user, request.query || {}) }
  }
  if (method === "GET" && path.startsWith("/orders/")) {
    const order = await findOrder(user, path.slice("/orders/".length))
    return order ? { status: 200, body: order } : { status: 404, body: { error: "not found" } }
  }
  if (method === "GET" && path.startsWith("/products/")) {
    const product = await getProduct(path.slice("/products/".length))
    return product ? { status: 200, body: product } : { status: 404, body: { error: "not found" } }
  }
  return { status: 404, body: { error: "not found" } }
}
EOF
cat > public/app.js <<'EOF'
export function renderOrders(orders) {
  const rows = orders.map((order) =>
    `<li class="order"><b>${order.id}</b> <span class="total">${order.total}</span> <i class="note">${order.note}</i></li>`)
  return `<ul class="orders">${rows.join("")}</ul>`
}
EOF
cat > public/index.html <<'EOF'
<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Orders</title></head>
<body><main id="orders"></main><script type="module" src="./app.js"></script></body></html>
EOF
cat > test/orders.test.mjs <<'EOF'
import { test, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { handle } from "../src/router.mjs"
import { reset } from "../src/store.mjs"

const as = (token) => ({ authorization: "Bearer " + token })

beforeEach(() => reset())

test("a customer places an order", async () => {
  const res = await handle({ method: "POST", path: "/orders", headers: as("t-alice"),
    body: { items: [{ productId: "p1", quantity: 1 }] } })
  assert.equal(res.status, 201)
  assert.equal(res.body.userId, "alice")
})

test("no token is rejected", async () => {
  const res = await handle({ method: "GET", path: "/orders", headers: {} })
  assert.equal(res.status, 401)
})
EOF
git add -A && git commit -q -m "chore: seed"
