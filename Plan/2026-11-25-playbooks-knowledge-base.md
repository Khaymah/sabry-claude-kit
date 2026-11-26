# Playbooks knowledge base

- Status: active
- Goal: A lazy-loaded library of atomic best-practice files (backend, frontend, security+devops) that agents route to through small INDEX files; later a guided /build workflow for non-programmers on top of it.
- Started: 2026-11-25

## Phase 1: Foundation
Acceptance: Playbooks/ with INDEX + _template, wired into inject-rules/kit_install/agents/rules, tests pass, routing eval case added
- [x] Playbooks/INDEX.md (domain router) + Playbooks/_template.md
- [x] Add `Playbooks` to KIT_FILES (hooks/inject-rules.py) and KIT_PATHS (hooks/kit_install.py)
- [x] One routing line in rules/knowledge-and-plans.md
- [x] "Read the domain INDEX" step in coding agents (backend-architect, senior-engineer, fron-end-developer, devops-sre, security-reviewer, code-reviewer)
- [x] Eval case evals/playbook-routing
- [x] python3 -m unittest in hooks/ passes

## Phase 2: Format sign-off
Acceptance: 3 sample backend playbooks reviewed and approved by the owner
- [x] Playbooks/backend/INDEX.md
- [x] Samples: auth/password-reset.md · data/money.md · reliability/idempotency.md
- [ ] Owner approves the format (or changes it)

## Phase 2b: Qualities first (owner decision)
Acceptance: quality/BASELINE.md + INDEX for quality, architecture, practices; Maintainability (6), Observability (7), Testability (5) written
- [x] Three axes: situations · qualities · architecture + practices; root INDEX updated
- [x] quality/BASELINE.md (all qualities per level, read on every code task)
- [x] quality/, architecture/, practices/ INDEX files
- [x] Maintainability: solid-pragmatic · module-boundaries · naming-structure · complexity-limits · refactoring · tech-debt
- [x] Observability: logging · request-correlation · error-tracking · metrics · health-checks · alerting · tracing
- [x] Performance: query-performance · round-trips · memory · event-loop-cpu
- [x] quality/TRAPS.md: mechanical trap catalog (Detect column), run by code-reviewer and senior-engineer
- [x] Template: two required edge-case rows (100× data, same action twice / in parallel)
- [x] Enforcement: hooks/enforce-code-traps.py (deny tier PreToolUse + warn tier PostToolUse), switch code_traps, Codex/Kimi/OpenCode wiring, 11 paired tests
- [x] ESLint preset shipped with the kit (no-await-in-loop, no-floating-promises, regexp, complexity limits)
- [x] Backfill the two required rows into the 20 files written before the rule
- [x] Testability: test-strategy · integration-db · e2e · concurrency-tests · test-data
- [x] Reliability: error-handling · graceful-shutdown · timeouts-retries · backpressure
- [x] Self-check: every ts example in Playbooks run through enforce-code-traps (only test-file code flagged)
- [x] Quality-Gate.md: one line per axis pointing to quality/<axis>/

## Phase 3: Backend
Acceptance: ~20 playbooks (api, auth, data, reliability, files) + backend INDEX
- [x] Backend: 23 playbooks written (api 4 · auth 6 · data 6 · reliability 5 · files 2); every ts example passes enforce-code-traps

## Phase 4: Security + DevOps
Acceptance: ~15 playbooks (secrets, headers, VPS+Nginx deploy, backups, monitoring) + INDEX
- [ ] List the files in security/INDEX.md and devops/INDEX.md, then write them

## Phase 5: Frontend
Acceptance: ~15 playbooks (forms, state, data fetching, i18n/RTL, a11y, perf) + INDEX
- [ ] List the files in frontend/INDEX.md, then write them

## Phase 6: Measure
Acceptance: routing eval passes with-plugin; tokens per task checked; README updated
- [ ] Run routing eval with/without plugin
- [ ] README.md + README.en.md section

## Phase 7: Guided /build workflow
Acceptance: skill for non-programmers built on the playbooks (planned after Measure)
- [ ] Design the /build skill (separate plan)

## Notes
- Language: English files; INDEX may carry Arabic keywords for routing.
- Examples: rule is stack-agnostic, full example in Bun + Hono + Drizzle, one line per other stack when it differs.
- Scope v1: Backend · Frontend · Security + DevOps. Mobile + AI later.
- Format v2 (owner feedback): Levels (Minimum/Standard/Advanced, project level recorded in .agents/memory) + "Skip when" + Edge cases table, separate from Pitfalls.
- Content rule: only opinionated decisions, mistakes models actually make, and verify checklists. Nothing the model already knows.
- Loading: never injected. Agent reads Playbooks/INDEX.md → domain INDEX → 1-3 files.
- Quality-Gate.md stays as design-time questions and links to Playbooks/quality (owner decision).
- Paths inside playbooks are relative to Playbooks/.
- Patterns/ and Anti-patterns/ stay for now; merge decided after Measure.
