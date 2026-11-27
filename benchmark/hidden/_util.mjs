export function firstArray(result) {
  if (Array.isArray(result)) return result
  if (result && typeof result === "object") {
    for (const key of ["items", "data", "orders", "Data", "Items", "rows", "results"]) if (Array.isArray(result[key])) return result[key]
    const found = Object.values(result).find(Array.isArray)
    if (found) return found
  }
  return null
}
export function minor(value) {
  if (typeof value === "bigint") return Number(value)
  if (typeof value === "number") return Number.isInteger(value) && Math.abs(value) >= 100 ? value : Math.round(value * 100)
  if (typeof value === "string") return value.includes(".") ? Math.round(Number(value) * 100) : Number(value)
  if (value && typeof value === "object") for (const k of ["minor", "cents", "amountMinor", "AmountMinor", "piastres", "value", "amount"]) if (k in value) return minor(value[k])
  return NaN
}
