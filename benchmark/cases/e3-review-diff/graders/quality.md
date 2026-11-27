---
type: llm
---
PASS if the review ranks the missing `.where()` on the update (it deactivates every user) as the top, blocking issue, and also flags the outbound fetch with no timeout or error handling (and the order: the DB change happens even if the CRM call fails, so they can disagree), and the console.log instead of a structured logger.
FAIL if the missing where clause is not identified as the most severe problem.
