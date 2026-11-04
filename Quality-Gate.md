# 🎯 Quality Gate: The Eight Axes (Enterprise Reference)

> **Source of truth for the eight axes.** **Mandatory** read for any architectural or technical decision, no exceptions (rule `CLAUDE.md §12.7`).
> Each axis is covered at enterprise depth + **the nine roles mapped onto it**, since every axis is a collective responsibility, not owned only by CTO/DevOps/Engineer.

**Reference standards:** ISO/IEC 25010:2023 (Product Quality, 9 characteristics, added Safety) • AWS Well-Architected (6 pillars) • Azure Well-Architected (5 pillars) • Google SRE • DORA / Accelerate • CNCF Observability • NIST.

---

## 🗺️ Master Matrix: Role × Axis

> 🟢 Primary owner (leads) • 🔵 Contributor (contributes a decision/requirement) • · marginal impact

| Axis | CTO | PM | ENG | UX | GRW | BA | OPS | BD | SEC |
|--------|:---:|:--:|:---:|:--:|:---:|:--:|:---:|:--:|:---:|
| ⚡ Scalability | 🟢 | 🔵 | 🟢 | 🔵 | 🔵 | 🔵 | 🟢 | 🔵 | · |
| 👁️ Observability | 🔵 | 🟢 | 🟢 | 🔵 | 🟢 | 🔵 | 🟢 | 🔵 | 🔵 |
| 🟢 Availability | 🟢 | 🔵 | 🔵 | 🔵 | · | 🔵 | 🟢 | 🔵 | 🔵 |
| 🔧 Maintainability | 🟢 | 🔵 | 🟢 | 🔵 | · | 🔵 | 🔵 | · | 🔵 |
| 🛡️ Reliability | 🔵 | 🔵 | 🟢 | · | · | 🔵 | 🟢 | 🔵 | 🔵 |
| 🔒 Security | 🔵 | 🔵 | 🔵 | 🔵 | 🔵 | 🔵 | 🔵 | 🔵 | 🟢 |
| 💰 Cost | 🟢 | 🔵 | 🔵 | · | 🟢 | 🟢 | 🟢 | 🟢 | · |
| 🚀 Performance | 🔵 | 🔵 | 🟢 | 🟢 | 🔵 | 🔵 | 🟢 | · | · |

> **Reading:** every role has 🟢/🔵 in most rows; no axis is "purely technical". Cost is led by 5 roles (CTO+Growth+BA+OPS+BD); **everyone** contributes to Security, even UX and Growth. That is enterprise thinking.

**Abbreviations:** CTO • PM (Senior PM) • ENG (Senior Engineer) • UX (UI/UX) • GRW (Growth) • BA (Business Analyst) • OPS (DevOps/SRE) • BD (Business Developer) • SEC (Cyber Security/vCISO).

---

## 1) ⚡ Scalability

**Enterprise scope:** not "can it take more load" but: does the system grow across **four dimensions** (load / data / geography / organization) at linear or better cost, without an architectural rewrite?

### Sub-domains (full coverage)

- **Load scaling:** horizontal vs vertical, statelessness (12-factor), session/state externalization, autoscaling policies (HPA/target-tracking), load shedding at saturation
- **Data scaling:** read replicas, sharding/partitioning, CQRS, deliberate denormalization, connection pooling, hot/cold data tiering, archival
- **Concurrency model:** thread pool vs event loop, backpressure, connection limits, queue-based load leveling, bulkheads
- **Async & decoupling:** message queues, event-driven, separating ingestion from processing, idempotent consumers
- **Caching (multi-layer):** CDN → edge → app cache → DB cache; invalidation strategy, cache stampede/thundering herd, TTL vs event-based
- **Geographic scaling:** multi-region, data locality/residency, edge compute, read-local/write-global
- **Bottleneck analysis:** Little's Law (L=λW), Universal Scalability Law (contention + coherency), capacity planning, load/stress/soak testing, headroom
- **Organizational scaling:** Conway's Law, Team Topologies, modular boundaries allowing independent teams, bounded contexts
- **Cost-aware scaling:** scale-to-zero, spot/preemptible, unit economics that stay healthy at 100×

### Mandatory questions (enterprise)

- At **10× and 100×** load: where is the **first** bottleneck? Shared mutable state / DB writes / single region / connection pool?
- Is scaling **linear**, or is there a contention/coherency penalty (USL) giving diminishing returns per added node?
- What **stateful** piece blocks horizontal scale? How do we externalize it (Redis/DB/object store)?
- Does the **data model** survive growth (right sharding key? hot partition?) or need redesign at some size?
- What is the current **headroom** (peak/capacity)? What triggers scaling before hitting the wall?
- Does team structure allow growth (modular) or is it an organizational monolith creating merge hell?

### 🎭 Role distribution

- **🟢 CTO:** architecture style (modular monolith → services), sharding/tenancy strategy, build vs buy, two-way vs one-way door
- **🟢 ENG:** stateless code, remove N+1, pagination, connection pooling, consumer idempotency
- **🟢 OPS:** autoscaling, capacity planning, load testing, infra elasticity, multi-region rollout
- **🔵 PM:** which roadmap features need scale, expected growth tolerance, scaling priority order
- **🔵 GRW:** anticipate spikes (campaigns/virality/launches become load), growth-driven capacity forecasting
- **🔵 BA:** volumes as NFRs (users/transactions/data growth) from requirements and contracts
- **🔵 BD:** contractual SLAs at large-customer volumes (tenant sizes, contractual volumes)
- **🔵 UX:** perceived performance under load, optimistic UI, pagination/infinite-scroll design
- **· SEC:** security controls (rate limiting/DDoS) must scale too without becoming a bottleneck

**Anti-patterns:** stateful sessions blocking horizontal scale • sharding key creating a hot partition • caching without invalidation strategy • K8s/microservices before PMF (over-engineering) • ignoring USL (assuming 2× nodes = 2× performance).

---

## 2) 👁️ Observability

**Enterprise scope:** not "we have logs" but: can we answer an **unanticipated question** about production behavior **without deploying new code**? (the true observability test).

### Sub-domains (full coverage)

- **Pillars:** Metrics + Logs + Traces (+ **Continuous Profiling** + Events), OpenTelemetry as the unified standard
- **Structured logging:** JSON, correlation/request IDs, log levels, PII scrubbing, centralization (Loki/ELK/Datadog), retention (hot/cold)
- **Metrics methodologies:** **Four Golden Signals** (Latency/Traffic/Errors/Saturation) for services • **RED** (Rate/Errors/Duration) for requests • **USE** (Utilization/Saturation/Errors) for resources
- **Distributed tracing:** span context propagation, sampling (head/tail), trace-to-log correlation
- **SLI/SLO/SLA + Error Budgets:** definitions, burn-rate alerting (multi-window), budget governs release speed
- **Alerting discipline:** page-worthy only (no alert fatigue), runbook per alert, symptom-based not cause-based
- **Dashboards per audience:** exec (business KPIs) / ops (golden signals) / dev (traces)
- **Frontend/RUM:** Core Web Vitals, session replay, JS errors, synthetic monitoring
- **Product & business observability:** funnels, feature adoption, north-star instrumentation, cohort/retention
- **Cost observability (FinOps):** cost per feature/tenant/request, budgets and alerts
- **Security observability:** audit trails, SIEM, tamper-resistant logs (overlaps Security)
- **Data observability:** freshness, volume, schema drift, pipeline quality

### Mandatory questions (enterprise)

- **After deploy:** how do we know it works? How do we know it **failed before the customer complains**?
- Can I trace a single request **end-to-end** across all services via correlation ID?
- What are the top three **SLIs** for this component? What is the SLO? Who is notified at high burn-rate?
- Are logs **searchable** and structured, or `console.log("here")`? Free of PII/secrets?
- Which **business events** must be observed (not only technical) to measure the feature's success?
- Are alerts **symptom-based** (user affected) or cause-based noise that gets ignored?

### 🎭 Role distribution

- **🟢 OPS:** telemetry stack, SLO engineering, burn-rate alerting, dashboards, tracing infra, retention
- **🟢 ENG:** in-code instrumentation (structured logs, spans, custom metrics), meaningful error context
- **🟢 PM:** product metrics, funnels, feature success KPIs, defining which business events to observe
- **🟢 GRW:** analytics instrumentation, A/B measurement, attribution, cohort/retention tracking
- **🔵 CTO:** observability strategy, build vs buy (Datadog vs OSS), what to measure and why
- **🔵 SEC:** audit/security event logging, SIEM, tamper-resistance, forensics readiness
- **🔵 BA:** measurable acceptance criteria, KPIs translated to business value
- **🔵 UX:** RUM, Core Web Vitals, session replay, UX metrics (task success, error rate)
- **🔵 BD:** SLA reporting to customers, status page, contractual observability commitments

**Anti-patterns:** unstructured logs • alerting on everything (fatigue) • vanity metrics instead of SLIs • technical monitoring without business monitoring • dashboards without a defined audience • PII/secrets in logs.

---

## 3) 🟢 Availability

**Enterprise scope:** not "up or down" but: what is the **composite availability** of the dependency chain, how does the system **degrade gracefully** (no total collapse) when a component fails, and how long to recover?

### Sub-domains (full coverage)

- **Redundancy:** N+1/N+2, multi-AZ, multi-region, active-active vs active-passive, eliminate every SPOF layer by layer
- **Health & failover:** health checks (liveness/readiness), automatic failover, leader election, quorum
- **Graceful degradation:** fallbacks, feature flags for shedding, read-only mode, cached-stale responses
- **Resilience patterns:** Circuit Breaker, Bulkhead, Retry+backoff+jitter, Timeout, Idempotency, Rate limiting, Load shedding
- **Deployment safety:** blue/green, canary (5→25→50→100), instant rollback, zero-downtime migrations (expand/contract), feature flags
- **Dependency isolation:** vendor/third-party failure must not take the system down, timeouts on every external call, fallback paths
- **Disaster Recovery:** RTO/RPO, backup strategy (3-2-1-1), periodic **restore testing**, cross-region replication, DR drills
- **Availability math:** the nines (99.9% = 8.76h/year), **composite** = product of dependency availabilities (a chain is weaker than its weakest link)
- **Chaos engineering:** fault injection, game days, testing assumptions
- **Maintenance:** always-on vs maintenance windows, rolling updates

### Mandatory questions (enterprise)

- What is every **SPOF** on the path (DB primary, single region, single AZ, single vendor, single key)?
- When this component fails: does the system **degrade gracefully** or collapse? What is the fallback?
- What is the real **composite availability** after multiplying all dependencies? (a 99.9% service depending on 3 services at 99.9% = ~99.6%)
- What **RTO/RPO** is actually required? Is the backup **restore-tested** or just hope?
- How do we deploy **with no downtime**? What triggers automatic rollback?
- What happens when an **external vendor** (Stripe/S3/Auth provider) goes down? Do we have timeout + degradation?

### 🎭 Role distribution

- **🟢 CTO:** availability target vs cost, resilience architecture, dependency strategy, two-way door
- **🟢 OPS:** redundancy, failover, DR, load balancing, deployment strategy, chaos, restore tests
- **🔵 ENG:** in-code resilience patterns (circuit breaker, retry, idempotency, timeouts, graceful degradation)
- **🔵 SEC:** availability as a security property (DDoS protection, ransomware recovery, backup immutability)
- **🔵 BA:** SLA requirements, hourly downtime cost, RTO/RPO from business need
- **🔵 BD:** contractual uptime/SLA commitments, service credits, enterprise expectations
- **🔵 PM:** which features are availability-critical (tiering), acceptable downtime per path
- **🔵 UX:** offline-first, error/retry states, failure messages that preserve trust
- **· GRW:** availability during launches/campaigns (a launch that goes down = growth killed)

**Anti-patterns:** a single SPOF (DB/region/AZ) • backup without restore test • no staging (production is staging) • Friday deploy to production • external call without timeout • retry without backoff/jitter (amplifies failure) • computing one component's availability and ignoring the chain.

---

## 4) 🔧 Maintainability

**Enterprise scope:** not "clean code" but: how much **time and risk** to make a safe change a year later, by a developer who didn't write the code? (true measure: DORA lead time + change failure rate).

### Sub-domains (full coverage)

- **Code quality:** SOLID, high cohesion/low coupling, cyclomatic complexity, naming, clean code
- **Modularity & boundaries:** DDD, bounded contexts, modular monolith, dependency direction (one-way), ports/adapters
- **Testing strategy:** test pyramid, critical-path coverage, maintainable tests, contract testing, TDD where useful
- **Documentation:** ADRs (why), C4 diagrams, runbooks, API docs, onboarding docs
- **Technical debt management:** debt register, deliberate vs inadvertent (Fowler quadrant), continuous refactoring budget
- **Change enablement / DORA:** deployment frequency, lead time for changes, change failure rate, MTTR; all four together measure maintainability
- **Consistency & paved roads:** conventions, linting/formatting, templates, secure/correct-by-default scaffolds
- **Versioning & compatibility:** semantic versioning, backward compat, API contracts, migration paths, deprecation policy
- **Dependency hygiene:** regular updates, deprecation tracking, supply chain (overlaps Security)
- **Knowledge distribution:** bus factor, CODEOWNERS, pairing, reduce siloed specialization

### Mandatory questions (enterprise)

- Who maintains this after **a year**? Can a new developer understand it **without its author**?
- Does the decision **increase** or reduce tech debt? If it increases it, is it **deliberate and documented** debt with a payoff plan?
- What **DORA metrics** are expected? Does the change slow lead time or raise change failure rate?
- Are boundaries clear, or will it become a **big ball of mud**? Are dependencies one-way?
- Is there an **ADR** documenting "why" for future generations?
- Is this abstraction **justified** (3 instances) or premature (two)? A wrong abstraction is worse than duplication.

### 🎭 Role distribution

- **🟢 CTO:** architecture boundaries, tech debt strategy, standards, ADRs, Conway's Law, versioning policy
- **🟢 ENG:** clean code, tests, refactoring, SOLID, naming, reducing complexity, Boy Scout Rule
- **🔵 OPS:** CI/CD, DORA metrics, deployment automation, runbooks, IaC (no snowflakes)
- **🔵 SEC:** dependency hygiene, secure-by-default templates (maintainable security, not patched-on)
- **🔵 PM:** prioritizing tech debt vs features, sustainable pace, reserving refactoring time in the roadmap
- **🔵 BA:** clear, traceable requirements (traceability) reducing rework, documenting business rules
- **🔵 UX:** design system, component reuse, consistency: a maintainable UI
- **· BD:** delivery quality (handoff docs) and the customer's ability to maintain what they receive

**Anti-patterns:** God class/function • premature abstraction • magic numbers/strings • comments explaining "what" instead of "why" • no ADRs (decisions forgotten and re-debated) • undocumented tech debt (compounding interest) • bus factor = 1 • snowflake servers.

---

## 5) 🛡️ Reliability

**Enterprise scope:** not "doesn't go down" (that's availability) but: does it always produce the **correct result**, especially under partial failure, concurrency, and errors? (functional and data correctness).

### Sub-domains (full coverage)

- **Correctness under failure:** fail-safe defaults, fail-closed (security) vs fail-open (availability), a conscious contextual decision
- **Data integrity:** ACID, transactions, referential integrity, constraints in the DB (not only the app), checksums
- **Consistency models:** strong vs eventual, CAP/PACELC, handle eventual consistency explicitly, read-your-writes
- **Idempotency & delivery semantics:** idempotency keys, exactly-once (in practice at-least-once + dedup), ordering guarantees
- **Error handling:** typed errors, exhaustive handling, no swallowed exceptions, error boundaries, fail fast
- **Async reliability:** retry safety, dead-letter queues, poison message handling, saga/compensation for distributed transactions
- **Concurrency correctness:** race conditions, locking (optimistic/pessimistic), isolation levels, atomic operations
- **Durability:** replication, backups, corruption detection, point-in-time recovery
- **Reliability testing:** property-based, fuzzing, fault injection, contract testing, chaos
- **Self-healing & reconciliation:** reconciliation loops, drift detection, eventual correctness

### Mandatory questions (enterprise)

- On failure: does the system **fail closed or open**? Is that right **for this context** (security vs availability)?
- Is the operation **idempotent**? What happens if the request/message repeats twice? (retries are inevitable in distributed systems)
- Where is **data integrity** guaranteed: in the DB (transactions/constraints) or just hoped for in app code?
- What is the **consistency model**? Did we handle eventual consistency explicitly or assume strong?
- Where are possible **race conditions**? What is the concurrency control mechanism?
- Are errors **fully handled** or is there a `catch {}` swallowing bugs? Is there a DLQ for failed messages?

### 🎭 Role distribution

- **🟢 ENG:** error handling, idempotency, transactions, race conditions, in-code data integrity, DLQ
- **🟢 OPS:** error budgets, fault injection, durability, backup integrity, replication health
- **🔵 CTO:** choosing the consistency model (CAP/PACELC), data architecture, reliability vs latency
- **🔵 SEC:** Integrity as a CIA triad pillar, tamper detection, secure/consistent state
- **🔵 BA:** data integrity requirements (financial accuracy, compliance), reliability acceptance criteria
- **🔵 BD:** reliability guarantees in contracts (data accuracy SLAs)
- **🔵 PM:** acceptable error rate per feature, reliability tiering
- **🔵 GRW:** tracking reliability (wrong data = wrong growth decisions)
- **· UX:** reliable feedback (reconciling optimistic UI with truth, consistency of what the user sees)

**Anti-patterns:** `catch (e) {}` • non-idempotent operation with retries • data integrity in the app instead of DB constraints • assuming strong consistency on an eventual system • retry on a non-idempotent operation (duplicate side effects) • ignoring race conditions • failed messages lost without a DLQ.

---

## 6) 🔒 Security

**Enterprise scope:** ⚠️ **not "input validation + authz"**, that is a small code-level slice. Full security = the **CIA triad** (Confidentiality/Integrity/Availability) across the entire lifecycle. **This axis fully activates the role [Cyber-Security.md](Roles/Cyber-Security.md)**; consult it for depth. Scope summary:

### Sub-domains (full coverage, 15 areas)

- **Identity & AuthN:** MFA/passkeys (FIDO2), session management, SSO/OIDC, federation, password storage (Argon2id)
- **Authorization:** RBAC/ABAC/ReBAC, least privilege, **object-level (BOLA/IDOR)**, function-level (BFLA), **tenant isolation** below the code layer (RLS)
- **Input & Output:** validation/allowlist, output encoding, injection prevention (SQL/NoSQL/command/template), SSRF, deserialization, file upload, mass assignment
- **Data protection:** encryption at rest/in transit/field-level, key management (KMS/rotation), tokenization, **data classification**, PII handling
- **Secrets management:** vaults, rotation, no hardcoding, OIDC federation (no static keys in CI)
- **Network security:** segmentation, **Zero Trust** (NIST 800-207), WAF, TLS 1.3, mTLS, IMDSv2
- **Supply chain security:** dependencies (lockfile/cooldown/ignore-scripts), SBOM, SLSA, CI/CD security (pinned actions, OIDC)
- **Threat modeling:** STRIDE, trust boundaries, attack surface, blast radius (design-time)
- **Detection & IR:** security logging, SIEM, IR plan, forensics readiness, breach notification clocks
- **Compliance & Privacy:** GDPR, SOC 2, ISO 27001, PCI DSS, HIPAA, data residency, privacy by design
- **AI/LLM security:** prompt injection (OWASP LLM Top 10), agentic security, MCP tool vetting, output-as-untrusted
- **Human & endpoint:** phishing/BEC, device security, MFA, security awareness, deepfake/social engineering
- **Vulnerability management:** scanning (SAST/DAST/SCA), triage (KEV/EPSS), patching SLAs, pentest, VDP
- **Governance:** risk register, policies, **documented risk acceptance** (never silent), secure-by-design
- **BC/DR (security angle):** ransomware resilience, backup immutability, recovery

### Mandatory questions (enterprise; minimum in the gate)

- **Confidentiality:** who accesses this data? Is authz at the **object** level (BOLA)? Is tenant isolation enforced below the code? Encrypted at rest/in transit?
- **Integrity:** can data/messages be tampered with? Are signing/verification present? (overlaps Reliability)
- **Availability (security-wise):** DDoS? Rate limiting? Ransomware recovery?
- **Blast radius:** if this component/key is compromised, what does the attacker reach?
- **Secrets:** where do they live? Rotatable within an hour? Anything in git/CI logs?
- **Supply chain:** what if a dependency is compromised? Lockfile + cooldown + ignore-scripts?
- **Compliance:** which framework applies (GDPR/SOC2/PCI)? Are we controller or processor?
- **AI features:** is model output treated as untrusted? Least-privilege for agent tools? Approval gate on irreversible actions?

### 🎭 Role distribution

- **🟢 SEC (vCISO):** owns the whole axis; activates [Cyber-Security.md](Roles/Cyber-Security.md) in full depth
- **🔵 CTO:** security architecture, secure-by-design, security vs speed (conscious trade-off)
- **🔵 ENG:** secure coding, the code-level slice (validation, authz checks, encoding, no secrets)
- **🔵 OPS:** infra hardening, secrets management, network security, CI/CD security
- **🔵 PM:** security/privacy as a requirement and feature, privacy by design in the product
- **🔵 BA:** compliance requirements, data classification, regulatory constraints
- **🔵 BD:** security in deals (questionnaires, DPAs, trust as a sales enabler)
- **🔵 GRW:** privacy-respecting analytics, consent, marketing compliance (cookie/email)
- **🔵 UX:** security UX (secure defaults, permission prompts, phishing-resistant design, consent flows)

**Anti-patterns:** reducing security to "validation + authz" • scattered authz instead of centralized • tenant isolation relying on developer memory • secrets in git/CI • security as a final pentest instead of design-time • "we're small, not a target" • security theater • FUD instead of quantified risk • LLM output straight into SQL/shell.

---

## 7) 💰 Cost

**Enterprise scope:** not "the cloud bill" but: **3-year TCO** + **unit economics** that stay healthy with growth + opportunity cost and lock-in. Cost saved in dev may be lost many times over in ops.

### Sub-domains (full coverage)

- **Cloud cost / FinOps:** rightsizing, reserved/savings plans, spot, autoscaling, scale-to-zero, tagging/allocation
- **Unit economics:** cost per user/tenant/transaction/request, margin per tier, relation to pricing
- **TCO:** build vs buy vs open-source, licensing, **vendor lock-in + exit cost**, opportunity cost, maintenance cost
- **Cost observability:** cost tagging, showback/chargeback, budgets + anomaly alerts, cost per feature
- **Efficiency-driven cost:** caching reduces compute, query optimization = savings, **egress costs** (the hidden trap), storage tiering
- **Engineering cost:** dev time, maintenance, **tech debt interest**, cost of delay
- **Third-party/API costs:** per-call pricing, **LLM token costs** (a huge trap in AI products), rate management
- **Risk cost:** expected cost of downtime/incident/breach (feeds the security spend equation)
- **Data costs:** storage tiers, retention policy, transfer/egress

### Mandatory questions (enterprise)

- What is the **3-year TCO** (dev + ops + licensing + maintenance), not just today's cost?
- What are the **unit economics**? Does cost-per-user stay healthy at 10×/100× or explode?
- **Build vs buy:** what is the lock-in and exit cost? What is the opportunity cost of building a commodity?
- What is the **hidden trap**: egress, LLM tokens, per-call APIs, idle resources, over-provisioning?
- Is cost **observed** (per feature/tenant) or a blind bill? What triggers an anomaly alert?
- Are we building complexity for **unneeded** scale (over-engineering = cost)?

### 🎭 Role distribution

- **🟢 CTO:** build vs buy, TCO, architectural cost efficiency, vendor strategy, avoiding over-engineering
- **🟢 GRW:** CAC/LTV, unit economics, monetization, cost per acquisition channel
- **🟢 BA:** ROI analysis, cost-benefit, payback period, NPV, business case
- **🟢 BD:** pricing strategy, margin, deal economics, cost-to-serve per tier
- **🟢 OPS:** FinOps, rightsizing, infra cost optimization, cost observability, spot/reserved
- **🔵 PM:** cost vs feature value, pricing model inputs, feature ROI
- **🔵 ENG:** efficient code (compute cost), avoiding costly patterns, **LLM token efficiency**, shutting down resources
- **· SEC:** security spend vs risk reduction (right-sizing, not theater)
- **· UX:** design that lowers support cost (self-service, clarity reduces tickets)

**Anti-patterns:** ignoring TCO (saving in dev = loss in ops) • ignoring egress/LLM tokens • over-provisioning "just in case" • lock-in without exit strategy • building a commodity instead of buying • over-engineering for nonexistent scale • cloud bill without tagging/monitoring.

---

## 8) 🚀 Performance

**Enterprise scope:** not "fast" but: does it meet a defined **latency/throughput budget** on business-relevant paths, at p95/p99 (not the average), accounting for **perceived** performance?

### Sub-domains (full coverage)

- **Latency:** p50/p95/**p99/p99.9** (tail latency is the real experience), perceived vs actual, TTFB
- **Throughput:** requests/sec, concurrent capacity, saturation point
- **Frontend performance:** **Core Web Vitals** (LCP/INP/CLS), bundle size, code splitting, lazy loading, critical rendering path, hydration cost
- **Backend performance:** query optimization, N+1, caching, connection pooling, async offloading of heavy work
- **Database performance:** indexing, query plans (EXPLAIN), deliberate denormalization, read replicas, partition pruning
- **Network:** CDN, compression (brotli), HTTP/2/3, keep-alive, edge, geographic latency, request coalescing
- **Algorithmic efficiency:** time/space complexity, appropriate data structures, avoid O(n²) on the hot path
- **Concurrency & resource:** parallelism, memory footprint, GC tuning, no blocking I/O on the hot path
- **Performance budgets & testing:** defined budget, regression testing, load/stress/soak/spike testing
- **Perceived performance:** optimistic UI, skeleton screens, progressive/streaming rendering, prefetching
- **Mobile/low-bandwidth:** performance on weak networks and mid-range devices

### Mandatory questions (enterprise)

- What performance does **this specific path** need? (checkout/search critical; admin report not) Does performance matter here at all?
- What is the **budget**: p95/p99 latency target? Do we measure the **tail** or hide behind the average?
- Where are the **N+1** and blocking I/O on the hot path? Are hot queries indexed?
- **Frontend:** what are LCP/INP/CLS? Bundle size? Is there code splitting/lazy loading?
- Can heavy work move to **async** (queue), off the request path?
- Do we use **perceived performance** (optimistic UI, skeletons, streaming) where actual speed can't improve?
- **Measure before optimizing**: is the optimization based on measurement or guesswork (premature optimization)?

### 🎭 Role distribution

- **🟢 ENG:** algorithmic efficiency, query optimization, caching, N+1, async offloading
- **🟢 UX:** Core Web Vitals, perceived performance, optimistic UI, progressive loading, mobile
- **🟢 OPS:** infra performance, CDN, load testing, capacity, performance monitoring/APM
- **🔵 CTO:** performance architecture, latency budget, sync vs async, edge strategy, caching strategy
- **🔵 PM:** performance as a feature (which paths must be fast), perf SLIs, speed priority
- **🔵 GRW:** performance → conversion (every 100ms costs conversion; speed is a proven growth lever)
- **🔵 BA:** performance NFRs from the business (response time, transaction volumes)
- **· BD:** performance SLAs in enterprise contracts
- **· SEC:** security controls must not kill performance (crypto/WAF overhead), nor performance kill security

**Anti-patterns:** measuring the average instead of p95/p99 • premature optimization (optimizing without measuring) • N+1 queries • blocking I/O on the hot path • huge bundle without splitting • ignoring perceived performance • optimizing an unimportant path (admin) and neglecting the critical one (checkout) • hidden O(n²).

---

## 🎬 Running the Gate (without bureaucracy)

1. **Scan** the Master Matrix above: which axes are load-bearing for this decision? (usually 2-4)
2. **For each load-bearing axis:** open its section, ask its mandatory questions, and decide **which role** must contribute (from the role distribution)
3. **The rest:** `N/A + one-line reason`: a conscious drop, not silence
4. **When two axes conflict:** explicit conscious trade-off (we sacrifice X for Y because..., e.g. Cost vs Availability)
5. **Activate the relevant roles:** if Security is load-bearing, read [Cyber-Security.md](Roles/Cyber-Security.md); if Observability/Availability/Reliability, [DevOps-SRE.md](Roles/DevOps-SRE.md); and so on

**⚠️ Anti-pattern of the gate itself:** forcing all eight equally on a trivial decision = over-engineering and ritual. The goal is **enterprise engineering awareness**, not a bureaucratic form filled mechanically.
