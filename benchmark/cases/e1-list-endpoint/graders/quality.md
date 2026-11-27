---
type: llm
focus: { source: file, path: src/orders.mjs }
---
PASS if listCustomerOrders filters by customer, returns a bounded page (a default limit and a server-side maximum), orders by a stable sort that includes a unique tie-breaker (for example createdAt then id), and pages with a cursor/keyset (or at least returns what the client needs to fetch the next page, such as nextCursor or hasMore) without loading every order of the customer into memory.
FAIL if it returns all orders, has no maximum limit, or sorts only by a non-unique column.
