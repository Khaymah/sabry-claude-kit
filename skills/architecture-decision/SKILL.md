---
name: architecture-decision
description: Load-bearing technical decisions - choosing a stack or framework, a schema or data model, an API contract, an integration, auth/authz design, a pricing model, build vs buy. Applies the kit's Quality-Gate and records an ADR. Use when the owner asks "which should we use", "design the architecture", "هنستخدم إيه", "قرار معماري", or when a change is hard to reverse.
---

# Architecture decision

Reply in the owner's language (profile; default Egyptian Arabic). The kit folder is two levels above this skill's base directory.

1. Read `<kit>/Quality-Gate.md` (the eight axes) in depth.
2. Address the 2–4 axes that are actually load-bearing; drop each of the others with a one-line reason.
3. On conflict, state the trade-off explicitly ("we give up X for Y because …").
4. Recommend one option. Then record an ADR in `Decisions/Global/` or `Decisions/<Project>/` (auto-numbered, format in `<kit>/Decisions/README.md`) and tell the owner in one line.

**Not ADR-worthy:** code style, where helper functions live, anything easily reversible.
**Warning:** forcing all eight axes onto a trivial decision is over-engineering. The goal is awareness, not ritual.
