export const stats = { queries: 0 }
const tables = { orders: [], customers: [], items: [] }
const delay = () => new Promise((r) => setTimeout(r, 2))
const matches = (row, where) => Object.entries(where).every(([k, v]) => (Array.isArray(v) ? v.includes(row[k]) : row[k] === v))
export async function query(table, where = {}) { stats.queries++; await delay(); return tables[table].filter((r) => matches(r, where)).map((r) => ({ ...r })) }
export function seed(table, rows) { tables[table].push(...rows.map((r) => ({ ...r }))) }
export function reset() { for (const k of Object.keys(tables)) tables[k] = []; stats.queries = 0 }
