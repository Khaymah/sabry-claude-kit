# Architecture playbooks

Load-bearing choices still go through the `architecture-decision` skill; these files hold the default answer it starts from.

| Situation | File | Status |
|---|---|---|
| New backend, folder layout, monolith vs services | `modular-monolith.md` | ✅ |
| Routes / controller / service / model, what goes where | `layering.md` | ✅ |
| Side effects, events, "after an order is created also…" | `events-side-effects.md` | ✅ |
| API or schema designed before code, shared types with the frontend | `contract-first.md` | ✅ |
| "Should this be a separate service?" | `when-to-split-service.md` | ✅ |
| Strategy, adapter, repository, factory: when they pay and when they don't | `design-patterns.md` | ✅ |
