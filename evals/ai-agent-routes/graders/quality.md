---
type: llm
---
PASS if the reply asks for or defines an eval set before choosing, addresses cost per request or the smallest model that passes, covers retrieval from the documents, and treats retrieved or user text as untrusted (prompt injection).
FAIL if it just names a model from memory with no eval and no cost.
