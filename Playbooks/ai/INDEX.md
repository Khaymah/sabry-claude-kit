# AI playbooks

Pick 1–3 files whose situation matches the task. File paths in this table are relative to this folder; paths inside playbooks are relative to `Playbooks/`. `planned` = not written yet: work without it and say so.

Default provider in examples: Anthropic Claude via `@anthropic-ai/sdk`, always behind an adapter. Model ids and prices change: check current model list and pricing before hardcoding anything.

| Situation | File | Status |
|---|---|---|
| Call an LLM from the backend: timeouts, retries, streaming, JSON output, logging | `llm-calls.md` | ✅ |
| Answer questions from the tenant's own documents, embeddings, pgvector, citations | `rag.md` | ✅ |
| The model reads user documents, emails or web pages, or can call tools | `prompt-injection.md` | ✅ |
| AI bill, per-tenant budgets, caching, model choice, abuse by long inputs | `cost-limits.md` | ✅ |
| Test an AI feature, prompt change, model upgrade, "is it better now" | `evals.md` | ✅ |
| Customer-support chatbot, handoff to a human, Arabic dialects, no invented prices | `chatbots.md` | ✅ |
