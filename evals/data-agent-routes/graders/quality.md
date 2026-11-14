---
type: llm
---
PASS if the reply defines the metric before the query (who counts as a customer, the 30-day window measured from the first order, which order statuses are excluded), gives SQL that counts distinct customers rather than orders, and states a caveat such as customers whose 30-day window has not finished yet.
FAIL if it gives a query with no metric definition, or counts orders instead of customers.
