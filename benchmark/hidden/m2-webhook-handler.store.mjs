export const calls = { markPaid: 0 }
let orders = new Map()
const delay = () => new Promise((r) => setTimeout(r, 1))
export async function getOrder(id) { await delay(); const o = orders.get(id); return o ? { ...o } : null }
export async function markPaid(id) { await delay(); calls.markPaid++; const o = orders.get(id); if (o) o.status = "paid" }
export function _orders() { return orders }
export function _reset() { orders = new Map([["ord_1", { id: "ord_1", totalCents: 15050, currency: "EGP", status: "pending" }]]); calls.markPaid = 0 }
