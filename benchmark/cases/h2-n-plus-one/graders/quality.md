---
type: llm
focus: { source: file, path: src/orders.mjs }
---
PASS if listOrdersPage now runs a constant number of queries regardless of how many orders there are (one for orders, one for all their customers by an id list, one for all their items by an orderId list), groups results in memory with a Map or equivalent, and keeps the returned shape identical (including customerName null when missing and itemCount 0 when there are no items).
FAIL if it still queries per order, including through Promise.all over the orders, or changes the returned shape.
