# 🎯 Quality Gate — المحاور الثمانية (Enterprise Reference)

> **مصدر الحقيقة للمحاور الثمانية.** يُقرأ **إلزامياً** عند أي قرار معماري أو تقني — لا استثناء (قاعدة `CLAUDE.md §12.7`).
> كل محور هنا مغطّى بعمق enterprise + **توزيع الأدوار التسعة عليه** — لأن أي محور مسؤولية جماعية، ليست حكراً على CTO/DevOps/Engineer.

**المراجع المعيارية:** ISO/IEC 25010:2023 (Product Quality — 9 خصائص، أضافت Safety) • AWS Well-Architected (6 pillars) • Azure Well-Architected (5 pillars) • Google SRE • DORA / Accelerate • CNCF Observability • NIST.

---

## 🗺️ Master Matrix — الدور × المحور

> 🟢 Primary owner (يقود) • 🔵 Contributor (يساهم بقرار/متطلب) • · تأثير هامشي

| المحور | CTO | PM | ENG | UX | GRW | BA | OPS | BD | SEC |
|--------|:---:|:--:|:---:|:--:|:---:|:--:|:---:|:--:|:---:|
| ⚡ Scalability | 🟢 | 🔵 | 🟢 | 🔵 | 🔵 | 🔵 | 🟢 | 🔵 | · |
| 👁️ Observability | 🔵 | 🟢 | 🟢 | 🔵 | 🟢 | 🔵 | 🟢 | 🔵 | 🔵 |
| 🟢 Availability | 🟢 | 🔵 | 🔵 | 🔵 | · | 🔵 | 🟢 | 🔵 | 🔵 |
| 🔧 Maintainability | 🟢 | 🔵 | 🟢 | 🔵 | · | 🔵 | 🔵 | · | 🔵 |
| 🛡️ Reliability | 🔵 | 🔵 | 🟢 | · | · | 🔵 | 🟢 | 🔵 | 🔵 |
| 🔒 Security | 🔵 | 🔵 | 🔵 | 🔵 | 🔵 | 🔵 | 🔵 | 🔵 | 🟢 |
| 💰 Cost | 🟢 | 🔵 | 🔵 | · | 🟢 | 🟢 | 🟢 | 🟢 | · |
| 🚀 Performance | 🔵 | 🔵 | 🟢 | 🟢 | 🔵 | 🔵 | 🟢 | · | · |

> **القراءة:** كل عمود (دور) له 🟢/🔵 في أغلب الصفوف — لا يوجد محور "تقني بحت". Cost مثلاً يقوده 5 أدوار (CTO+Growth+BA+OPS+BD)، و Security يساهم فيه **الجميع** حتى UX و Growth. هذا ما يعنيه التفكير enterprise.

**اختصارات:** CTO • PM (Senior PM) • ENG (Senior Engineer) • UX (UI/UX) • GRW (Growth) • BA (Business Analyst) • OPS (DevOps/SRE) • BD (Business Developer) • SEC (Cyber Security/vCISO).

---

## 1) ⚡ Scalability — قابلية التوسع

**enterprise scope:** ليست "هل يتحمّل ضغط أكبر" — بل: هل ينمو النظام في **الأبعاد الأربعة** (load / data / geography / organization) بتكلفة خطية أو أفضل، دون إعادة كتابة معمارية؟

### Sub-domains (التغطية الكاملة)

- **Load scaling:** horizontal vs vertical، statelessness (12-factor)، session/state externalization، autoscaling policies (HPA/target-tracking)، load shedding عند التشبّع
- **Data scaling:** read replicas، sharding/partitioning، CQRS، denormalization المتعمّدة، connection pooling، hot/cold data tiering، archival
- **Concurrency model:** thread pool vs event loop، backpressure، connection limits، queue-based load leveling، bulkheads
- **Async & decoupling:** message queues، event-driven، الفصل بين الـ ingestion والـ processing، idempotent consumers
- **Caching (multi-layer):** CDN → edge → app cache → DB cache؛ invalidation strategy، cache stampede/thundering herd، TTL vs event-based
- **Geographic scaling:** multi-region، data locality/residency، edge compute، read-local/write-global
- **Bottleneck analysis:** Little's Law (L=λW)، Universal Scalability Law (contention + coherency)، capacity planning، load/stress/soak testing، headroom
- **Organizational scaling:** Conway's Law، Team Topologies، modular boundaries تسمح لفرق مستقلة، bounded contexts
- **Cost-aware scaling:** scale-to-zero، spot/preemptible، unit economics تبقى صحية عند 100×

### الأسئلة الإجبارية (enterprise)

- عند **10× و 100×** الحمل: أين **أول** bottleneck؟ هل هو shared mutable state / DB writes / single region / connection pool؟
- هل الـ scaling **linear** أم يوجد contention/coherency penalty (USL) يجعل إضافة عُقد تعطي عائداً متناقصاً؟
- ما الحالة الـ **stateful** التي تمنع الـ horizontal scale؟ كيف نُخرجها (Redis/DB/object store)؟
- هل الـ **data model** يتحمّل النمو (sharding key صحيح؟ hot partition؟) أم يتطلب إعادة تصميم عند حجم معيّن؟
- ما **headroom** الحالي (peak/capacity)؟ ما trigger للتوسّع قبل الوصول للجدار؟
- هل تصميم الفِرق يسمح بالنمو (modular) أم monolith تنظيمي يخلق merge hell؟

### 🎭 توزيع الأدوار

- **🟢 CTO:** اختيار نمط المعمارية (modular monolith → services)، sharding/tenancy strategy، build vs buy، two-way vs one-way door
- **🟢 ENG:** كود stateless، إزالة N+1، pagination، connection pooling، idempotency للـ consumers
- **🟢 OPS:** autoscaling، capacity planning، load testing، infra elasticity، multi-region rollout
- **🔵 PM:** أي features تحتاج scale (من الـ roadmap)، تحمّل النمو المتوقع، ترتيب أولوية التحمّل
- **🔵 GRW:** توقّع spikes (حملات/virality/launches تُترجم لحمل)، growth-driven capacity forecasting
- **🔵 BA:** الأحجام كـ NFR (users/transactions/data growth) من المتطلبات والعقود
- **🔵 BD:** SLAs تعاقدية على أحجام العملاء الكبار (tenant sizes، contractual volumes)
- **🔵 UX:** perceived performance تحت الحمل، optimistic UI، تصميم pagination/infinite-scroll
- **· SEC:** أن تتوسّع الـ security controls نفسها (rate limiting/DDoS) دون أن تصبح bottleneck

**Anti-patterns:** stateful sessions تمنع horizontal scale • sharding key يخلق hot partition • caching بلا invalidation strategy • K8s/microservices لمنتج قبل PMF (over-engineering) • تجاهل الـ USL (افتراض أن 2× العُقد = 2× الأداء).

---

## 2) 👁️ Observability — القابلية للرصد

**enterprise scope:** ليست "عندنا logs" — بل: هل نستطيع الإجابة على **سؤال لم نتوقّعه** عن سلوك النظام في الإنتاج **دون نشر كود جديد**؟ (المعيار الحقيقي لـ observability).

### Sub-domains (التغطية الكاملة)

- **الركائز:** Metrics + Logs + Traces (+ **Continuous Profiling** + Events) — OpenTelemetry كمعيار موحّد
- **Structured logging:** JSON، correlation/request IDs، log levels، PII scrubbing، centralization (Loki/ELK/Datadog)، retention (hot/cold)
- **Metrics methodologies:** **Four Golden Signals** (Latency/Traffic/Errors/Saturation) للـ services • **RED** (Rate/Errors/Duration) للـ requests • **USE** (Utilization/Saturation/Errors) للـ resources
- **Distributed tracing:** span context propagation، sampling (head/tail)، trace-to-log correlation
- **SLI/SLO/SLA + Error Budgets:** تعريفها، burn-rate alerting (multi-window)، الميزانية تحكم سرعة الإطلاق
- **Alerting discipline:** page-worthy فقط (لا alert fatigue)، runbook لكل alert، symptom-based لا cause-based
- **Dashboards per-audience:** exec (business KPIs) / ops (golden signals) / dev (traces)
- **Frontend/RUM:** Core Web Vitals، session replay، JS errors، synthetic monitoring
- **Product & Business observability:** funnels، feature adoption، north-star instrumentation، cohort/retention
- **Cost observability (FinOps):** cost per feature/tenant/request، budgets وتنبيهات
- **Security observability:** audit trails، SIEM، tamper-resistant logs (تقاطع مع Security)
- **Data observability:** freshness، volume، schema drift، quality للـ pipelines

### الأسئلة الإجبارية (enterprise)

- **بعد النشر:** كيف نعرف أنه يعمل؟ وكيف نعرف أنه **فشل قبل أن يشتكي العميل**؟
- هل يمكنني تتبّع request واحد **end-to-end** عبر كل الخدمات بـ correlation ID؟
- ما الـ **SLIs** الثلاثة الأهم لهذا المكوّن؟ ما الـ SLO؟ من يُخطَر عند burn-rate عالٍ؟
- هل الـ logs **قابلة للبحث** ومنظّمة، أم `console.log("here")`؟ وهل خالية من PII/secrets؟
- ما **الأحداث business** التي يجب رصدها (لا التقنية فقط) لقياس نجاح الـ feature؟
- هل الـ alerts **symptom-based** (المستخدم متأثر) أم ضوضاء cause-based تُتجاهَل؟

### 🎭 توزيع الأدوار

- **🟢 OPS:** telemetry stack، SLO engineering، burn-rate alerting، dashboards، tracing infra، retention
- **🟢 ENG:** instrumentation في الكود (structured logs، spans، custom metrics)، error context ذو معنى
- **🟢 PM:** product metrics، funnels، feature success KPIs، تعريف الأحداث business المطلوب رصدها
- **🟢 GRW:** analytics instrumentation، A/B measurement، attribution، cohort/retention tracking
- **🔵 CTO:** استراتيجية الرصد، build vs buy (Datadog vs OSS)، ماذا نقيس ولماذا
- **🔵 SEC:** audit/security event logging، SIEM، tamper-resistance، forensics readiness
- **🔵 BA:** acceptance criteria قابلة للقياس، KPIs تُترجم لقيمة عملية
- **🔵 UX:** RUM، Core Web Vitals، session replay، UX metrics (task success، error rate)
- **🔵 BD:** SLA reporting للعملاء، status page، التزامات observability تعاقدية

**Anti-patterns:** logs غير منظّمة • alert على كل شيء (fatigue) • قياس vanity metrics بدل SLIs • رصد تقني بلا رصد business • dashboards بلا جمهور محدد • PII/secrets في الـ logs.

---

## 3) 🟢 Availability — التوافرية

**enterprise scope:** ليست "up أم down" — بل: ما **composite availability** لسلسلة الاعتماديات، وكيف يتدهور النظام **بلطف** (لا انهياراً كاملاً) عند فشل أي مكوّن، وكم نستغرق للتعافي؟

### Sub-domains (التغطية الكاملة)

- **Redundancy:** N+1/N+2، multi-AZ، multi-region، active-active vs active-passive، إزالة كل SPOF طبقة بطبقة
- **Health & failover:** health checks (liveness/readiness)، automatic failover، leader election، quorum
- **Graceful degradation:** fallbacks، feature flags للـ shedding، read-only mode، cached-stale responses
- **Resilience patterns:** Circuit Breaker، Bulkhead، Retry+backoff+jitter، Timeout، Idempotency، Rate limiting، Load shedding
- **Deployment safety:** blue/green، canary (5→25→50→100)، rollback فوري، zero-downtime migrations (expand/contract)، feature flags
- **Dependency isolation:** فشل vendor/third-party لا يُسقط النظام، timeouts على كل external call، fallback paths
- **Disaster Recovery:** RTO/RPO، backup strategy (3-2-1-1)، **restore testing** دوري، cross-region replication، DR drills
- **Availability math:** الـ nines (99.9% = 8.76h/سنة)، **composite** = حاصل ضرب توافرية الاعتماديات (السلسلة أضعف من أضعف حلقة)
- **Chaos engineering:** fault injection، game days، اختبار الافتراضات
- **Maintenance:** always-on vs maintenance windows، rolling updates

### الأسئلة الإجبارية (enterprise)

- ما كل **SPOF** في المسار (DB primary، region واحد، AZ واحد، vendor واحد، مفتاح واحد)؟
- عند فشل هذا المكوّن: هل النظام **يتدهور بلطف** أم ينهار كلياً؟ ما الـ fallback؟
- ما **composite availability** الحقيقي بعد ضرب كل الاعتماديات؟ (خدمة 99.9% تعتمد على 3 خدمات 99.9% = ~99.6%)
- ما **RTO/RPO** المطلوب عملياً؟ هل الـ backup **مُختبَر الاستعادة** أم مجرد أمل؟
- كيف ننشر **بلا downtime**؟ ما trigger الـ rollback التلقائي؟
- ماذا يحدث حين يسقط **vendor خارجي** (Stripe/S3/Auth provider)؟ هل عندنا timeout + degradation؟

### 🎭 توزيع الأدوار

- **🟢 CTO:** availability target مقابل التكلفة، معمارية resilience، dependency strategy، two-way door
- **🟢 OPS:** redundancy، failover، DR، load balancing، deployment strategy، chaos، restore tests
- **🔵 ENG:** resilience patterns في الكود (circuit breaker، retry، idempotency، timeouts، graceful degradation)
- **🔵 SEC:** availability كخاصية أمنية (DDoS protection، ransomware recovery، backup immutability)
- **🔵 BA:** SLA requirements، تكلفة الـ downtime بالساعة، RTO/RPO من احتياج العمل
- **🔵 BD:** التزامات uptime/SLA التعاقدية، service credits، توقّعات enterprise
- **🔵 PM:** أي features حرجة التوافر (tiering)، downtime المقبول لكل مسار
- **🔵 UX:** offline-first، error/retry states، رسائل فشل تحافظ على الثقة
- **· GRW:** توافر أثناء الـ launches/campaigns (إطلاق يسقط = نمو يُقتَل)

**Anti-patterns:** SPOF واحد (DB/region/AZ) • backup بلا restore test • لا staging (production هو staging) • deploy الجمعة على production • external call بلا timeout • retry بلا backoff/jitter (يضخّم الفشل) • حساب توافرية مكوّن واحد وتجاهل السلسلة.

---

## 4) 🔧 Maintainability — القابلية للصيانة

**enterprise scope:** ليست "كود نظيف" — بل: كم **الوقت والمخاطرة** لإجراء تغيير آمن بعد سنة، بمطوّر لم يكتب الكود؟ (مقياسها الحقيقي: DORA lead time + change failure rate).

### Sub-domains (التغطية الكاملة)

- **Code quality:** SOLID، cohesion عالٍ/coupling منخفض، cyclomatic complexity، naming، clean code
- **Modularity & boundaries:** DDD، bounded contexts، modular monolith، dependency direction (اتجاه واحد)، ports/adapters
- **Testing strategy:** test pyramid، تغطية المسارات الحرجة، اختبارات قابلة للصيانة، contract testing، TDD حيث يفيد
- **Documentation:** ADRs (لماذا)، C4 diagrams، runbooks، API docs، onboarding docs
- **Technical debt management:** debt register، deliberate vs inadvertent (Fowler quadrant)، refactoring budget مستمر
- **Change enablement / DORA:** deployment frequency، lead time for changes، change failure rate، MTTR — الأربعة معاً مقياس القابلية للصيانة
- **Consistency & paved roads:** conventions، linting/formatting، templates، secure/correct-by-default scaffolds
- **Versioning & compatibility:** semantic versioning، backward compat، API contracts، migration paths، deprecation policy
- **Dependency hygiene:** updates منتظمة، deprecation tracking، supply chain (تقاطع Security)
- **Knowledge distribution:** bus factor، CODEOWNERS، pairing، تقليل التخصص المنعزل

### الأسئلة الإجبارية (enterprise)

- من يصون هذا بعد **سنة**؟ هل يفهمه مطوّر جديد **دون صاحبه**؟
- هل القرار **يزيد** الـ tech debt أم يقلّله؟ إن زاده — هل هو debt **متعمّد وموثّق** مع خطة سداد؟
- ما **DORA metrics** المتوقعة؟ هل التغيير يبطئ lead time أو يرفع change failure rate؟
- هل الحدود (boundaries) واضحة أم سيتحول لـ **big ball of mud**؟ هل الاعتمادية باتجاه واحد؟
- هل يوجد **ADR** يوثّق "لماذا" هذا القرار للأجيال القادمة؟
- هل هذا abstraction **مبرّر** (3 instances) أم premature (اثنان)؟ — التجريد الخاطئ أسوأ من التكرار

### 🎭 توزيع الأدوار

- **🟢 CTO:** حدود المعمارية، tech debt strategy، standards، ADRs، Conway's Law، versioning policy
- **🟢 ENG:** clean code، tests، refactoring، SOLID، naming، تقليل complexity، Boy Scout Rule
- **🔵 OPS:** CI/CD، DORA metrics، deployment automation، runbooks، IaC (لا snowflakes)
- **🔵 SEC:** dependency hygiene، secure-by-default templates (أمان قابل للصيانة لا مرقّع)
- **🔵 PM:** ترتيب tech debt مقابل features، سرعة مستدامة، حجز وقت refactoring في الـ roadmap
- **🔵 BA:** متطلبات واضحة وقابلة للتتبّع (traceability) تقلّل rework، توثيق قواعد العمل
- **🔵 UX:** design system، component reuse، consistency — UI قابل للصيانة
- **· BD:** جودة التسليم (handoff docs) وقابلية العميل لصيانة ما تسلّمه

**Anti-patterns:** God class/function • premature abstraction • magic numbers/strings • comments تشرح "ماذا" بدل "لماذا" • لا ADRs (قرارات تُنسى وتُعاد مناقشتها) • tech debt غير موثّق (فوائد مركّبة) • bus factor = 1 • snowflake servers.

---

## 5) 🛡️ Reliability — الموثوقية

**enterprise scope:** ليست "لا يسقط" (تلك availability) — بل: هل ينتج **النتيجة الصحيحة** دائماً، خاصة تحت الفشل الجزئي والتزامن والأخطاء؟ (سلامة الوظيفة والبيانات).

### Sub-domains (التغطية الكاملة)

- **Correctness under failure:** fail-safe defaults، fail-closed (أمان) vs fail-open (توافر) — قرار سياقي واعٍ
- **Data integrity:** ACID، transactions، referential integrity، constraints في الـ DB (لا في التطبيق فقط)، checksums
- **Consistency models:** strong vs eventual، CAP/PACELC، معالجة eventual consistency صراحةً، read-your-writes
- **Idempotency & delivery semantics:** idempotency keys، exactly-once (عملياً at-least-once + dedup)، ordering guarantees
- **Error handling:** typed errors، exhaustive handling، لا swallowed exceptions، error boundaries، fail fast
- **Async reliability:** retry safety، dead-letter queues، poison message handling، saga/compensation للـ distributed transactions
- **Concurrency correctness:** race conditions، locking (optimistic/pessimistic)، isolation levels، atomic operations
- **Durability:** replication، backups، corruption detection، point-in-time recovery
- **Reliability testing:** property-based، fuzzing، fault injection، contract testing، chaos
- **Self-healing & reconciliation:** reconciliation loops، drift detection، eventual correctness

### الأسئلة الإجبارية (enterprise)

- عند الفشل: هل النظام **fail closed أم open**؟ وهل هذا هو الصحيح **لهذا السياق** (أمان vs توافر)؟
- هل العملية **idempotent**؟ ماذا يحدث لو تكرّر الـ request/message مرتين؟ (retries حتمية في الأنظمة الموزّعة)
- أين **سلامة البيانات** مضمونة — في الـ DB (transactions/constraints) أم مجرد أمل في كود التطبيق؟
- ما نموذج **الاتساق**؟ هل تعاملنا مع eventual consistency صراحةً أم افترضنا strong؟
- أين **race conditions** الممكنة؟ ما آلية الـ concurrency control؟
- هل الأخطاء **مُعالَجة بالكامل** أم يوجد `catch {}` يبتلع bugs؟ هل يوجد DLQ للرسائل الفاشلة؟

### 🎭 توزيع الأدوار

- **🟢 ENG:** error handling، idempotency، transactions، race conditions، سلامة البيانات في الكود، DLQ
- **🟢 OPS:** error budgets، fault injection، durability، سلامة الـ backups، replication health
- **🔵 CTO:** اختيار نموذج الاتساق (CAP/PACELC)، معمارية البيانات، reliability مقابل latency
- **🔵 SEC:** Integrity كركيزة في CIA triad، tamper detection، secure/consistent state
- **🔵 BA:** متطلبات سلامة البيانات (دقة مالية، امتثال)، acceptance criteria للموثوقية
- **🔵 BD:** ضمانات الموثوقية في العقود (data accuracy SLAs)
- **🔵 PM:** معدل الأخطاء المقبول لكل feature، tiering الموثوقية
- **🔵 GRW:** موثوقية التتبّع (بيانات خاطئة = قرارات نمو خاطئة)
- **· UX:** feedback موثوق (تسوية optimistic UI مع الحقيقة، اتساق ما يراه المستخدم)

**Anti-patterns:** `catch (e) {}` • عملية غير idempotent مع retries • سلامة البيانات في التطبيق بدل constraints في الـ DB • افتراض strong consistency على نظام eventual • retry على عملية غير idempotent (تكرار جانبي) • تجاهل race conditions • رسائل فاشلة تُفقَد بلا DLQ.

---

## 6) 🔒 Security — الأمان

**enterprise scope:** ⚠️ **ليست "input validation + authz"** — تلك شريحة code-level صغيرة. الأمان الكامل = **CIA triad** (Confidentiality/Integrity/Availability) عبر كامل دورة الحياة. **هذا المحور يُفعّل دور [Cyber-Security.md](Roles/Cyber-Security.md) بالكامل** — راجعه للعمق. ملخص النطاق:

### Sub-domains (التغطية الكاملة — 15 مجالاً)

- **Identity & AuthN:** MFA/passkeys (FIDO2)، session management، SSO/OIDC، federation، password storage (Argon2id)
- **Authorization:** RBAC/ABAC/ReBAC، least privilege، **object-level (BOLA/IDOR)**، function-level (BFLA)، **tenant isolation** تحت طبقة الكود (RLS)
- **Input & Output:** validation/allowlist، output encoding، injection prevention (SQL/NoSQL/command/template)، SSRF، deserialization، file upload، mass assignment
- **Data protection:** encryption at rest/in transit/field-level، key management (KMS/rotation)، tokenization، **data classification**، PII handling
- **Secrets management:** vaults، rotation، لا hardcoding، OIDC federation (لا static keys في CI)
- **Network security:** segmentation، **Zero Trust** (NIST 800-207)، WAF، TLS 1.3، mTLS، IMDSv2
- **Supply chain security:** dependencies (lockfile/cooldown/ignore-scripts)، SBOM، SLSA، CI/CD security (pinned actions، OIDC)
- **Threat modeling:** STRIDE، trust boundaries، attack surface، blast radius (design-time)
- **Detection & IR:** security logging، SIEM، IR plan، forensics readiness، breach notification clocks
- **Compliance & Privacy:** GDPR، SOC 2، ISO 27001، PCI DSS، HIPAA، data residency، privacy by design
- **AI/LLM security:** prompt injection (OWASP LLM Top 10)، agentic security، MCP tool vetting، output-as-untrusted
- **Human & endpoint:** phishing/BEC، device security، MFA، security awareness، deepfake/social engineering
- **Vulnerability management:** scanning (SAST/DAST/SCA)، triage (KEV/EPSS)، patching SLAs، pentest، VDP
- **Governance:** risk register، policies، **risk acceptance موثّق** (لا صمتاً)، secure-by-design
- **BC/DR (security angle):** ransomware resilience، backup immutability، recovery

### الأسئلة الإجبارية (enterprise — الحد الأدنى في الـ gate)

- **Confidentiality:** من يصل لهذه البيانات؟ هل authz على مستوى **الكائن** (BOLA)؟ هل tenant isolation مفروض تحت الكود؟ هل مشفّرة at rest/in transit؟
- **Integrity:** هل يمكن العبث بالبيانات/الرسائل؟ هل التوقيع/التحقق موجود؟ (تقاطع مع Reliability)
- **Availability (أمنياً):** DDoS؟ rate limiting؟ ransomware recovery؟
- **Blast radius:** لو اختُرق هذا المكوّن/المفتاح — ماذا يطال المهاجم؟
- **Secrets:** أين تعيش؟ قابلة للـ rotation خلال ساعة؟ شيء في git/CI logs؟
- **Supply chain:** ماذا لو اختُرقت dependency؟ lockfile + cooldown + ignore-scripts؟
- **Compliance:** أي إطار ينطبق (GDPR/SOC2/PCI)؟ نحن controller أم processor؟
- **AI features:** output الـ model يُعامَل كـ untrusted؟ least-privilege للـ agent tools؟ approval gate على الأفعال غير القابلة للتراجع؟

### 🎭 توزيع الأدوار

- **🟢 SEC (vCISO):** يملك المحور كاملاً — يُفعّل [Cyber-Security.md](Roles/Cyber-Security.md) بكل عمقه
- **🔵 CTO:** security architecture، secure-by-design، أمان مقابل سرعة (trade-off واعٍ)
- **🔵 ENG:** secure coding — الشريحة code-level (validation، authz checks، encoding، لا secrets)
- **🔵 OPS:** infra hardening، secrets management، network security، CI/CD security
- **🔵 PM:** الأمان/الخصوصية كـ requirement وفeature، privacy by design في المنتج
- **🔵 BA:** متطلبات الامتثال، data classification، القيود التنظيمية
- **🔵 BD:** الأمان في الصفقات (questionnaires، DPAs، trust كـ sales enabler)
- **🔵 GRW:** analytics محترمة للخصوصية، consent، امتثال التسويق (cookie/email)
- **🔵 UX:** security UX (secure defaults، permission prompts، تصميم مقاوم للتصيّد، consent flows)

**Anti-patterns:** اختزال الأمان في "validation + authz" • authz متناثر بدل مركزي • tenant isolation بالاعتماد على ذاكرة المطور • secrets في git/CI • أمان كـ pentest نهائي بدل design-time • "نحن صغيرون لسنا هدفاً" • security theater • FUD بدل مخاطر مُرقّمة • output الـ LLM مباشرة لـ SQL/shell.

---

## 7) 💰 Cost — التكلفة

**enterprise scope:** ليست "فاتورة السحابة" — بل: **TCO على 3 سنوات** + **unit economics** تبقى صحية مع النمو + تكلفة الفرصة والـ lock-in. تكلفة تُوفَّر في dev قد تُخسَر أضعافاً في ops.

### Sub-domains (التغطية الكاملة)

- **Cloud cost / FinOps:** rightsizing، reserved/savings plans، spot، autoscaling، scale-to-zero، tagging/allocation
- **Unit economics:** cost per user/tenant/transaction/request، هامش لكل tier، علاقتها بالـ pricing
- **TCO:** build vs buy vs open-source، licensing، **vendor lock-in + exit cost**، opportunity cost، maintenance cost
- **Cost observability:** cost tagging، showback/chargeback، budgets + anomaly alerts، cost per feature
- **Efficiency-driven cost:** caching يقلّل compute، query optimization = توفير، **egress costs** (الفخ الخفي)، storage tiering
- **Engineering cost:** dev time، maintenance، **tech debt interest**، cost of delay
- **Third-party/API costs:** per-call pricing، **LLM token costs** (فخ ضخم في منتجات AI)، rate management
- **Risk cost:** تكلفة الـ downtime/incident/breach المتوقعة (تدخل في معادلة الإنفاق الأمني)
- **Data costs:** storage tiers، retention policy، transfer/egress

### الأسئلة الإجبارية (enterprise)

- ما **TCO على 3 سنوات** (dev + ops + licensing + maintenance)، لا تكلفة اليوم فقط؟
- ما **unit economics**؟ هل cost-per-user يبقى صحياً عند 10×/100× أم ينفجر؟
- **build vs buy:** ما تكلفة الـ lock-in والخروج؟ ما opportunity cost لبناء ما هو commodity؟
- ما **الفخ الخفي** — egress، LLM tokens، per-call APIs، idle resources، over-provisioning؟
- هل التكلفة **مرصودة** (per feature/tenant) أم فاتورة عمياء؟ ما trigger anomaly alert؟
- هل نبني تعقيداً لـ scale **غير مطلوب** (over-engineering = تكلفة)؟

### 🎭 توزيع الأدوار

- **🟢 CTO:** build vs buy، TCO، كفاءة المعمارية للتكلفة، vendor strategy، تجنّب over-engineering
- **🟢 GRW:** CAC/LTV، unit economics، monetization، cost per acquisition channel
- **🟢 BA:** ROI analysis، cost-benefit، payback period، NPV، business case
- **🟢 BD:** pricing strategy، الهامش، deal economics، cost-to-serve لكل tier
- **🟢 OPS:** FinOps، rightsizing، تحسين تكلفة الـ infra، cost observability، spot/reserved
- **🔵 PM:** تكلفة مقابل قيمة الـ feature، مدخلات pricing model، ROI للـ features
- **🔵 ENG:** كود كفؤ (compute cost)، تجنّب أنماط مكلفة، **LLM token efficiency**، إغلاق resources
- **· SEC:** حجم إنفاق الأمان مقابل تقليل المخاطر (right-sizing لا theater)
- **· UX:** تصميم يقلّل تكلفة الدعم (self-service، وضوح يقلّل التذاكر)

**Anti-patterns:** تجاهل TCO (التوفير في dev = خسارة في ops) • تجاهل egress/LLM tokens • over-provisioning "احتياطاً" • lock-in بلا exit strategy • بناء commodity بدل شرائه • over-engineering لـ scale غير موجود • فاتورة سحابة بلا tagging/رصد.

---

## 8) 🚀 Performance — الأداء

**enterprise scope:** ليست "سريع" — بل: هل يحقق **latency/throughput budget** محدّد للمسارات التي تهم العمل، عند p95/p99 (لا المتوسط)، مع مراعاة **الأداء المُدرَك** (perceived)؟

### Sub-domains (التغطية الكاملة)

- **Latency:** p50/p95/**p99/p99.9** (tail latency هي التجربة الحقيقية)، perceived vs actual، TTFB
- **Throughput:** requests/sec، concurrent capacity، saturation point
- **Frontend performance:** **Core Web Vitals** (LCP/INP/CLS)، bundle size، code splitting، lazy loading، critical rendering path، hydration cost
- **Backend performance:** query optimization، N+1، caching، connection pooling، async offloading للعمل الثقيل
- **Database performance:** indexing، query plans (EXPLAIN)، denormalization المتعمّدة، read replicas، partition pruning
- **Network:** CDN، compression (brotli)، HTTP/2/3، keep-alive، edge، geographic latency، request coalescing
- **Algorithmic efficiency:** time/space complexity، بنى البيانات المناسبة، تجنّب O(n²) على hot path
- **Concurrency & resource:** parallelism، memory footprint، GC tuning، لا blocking I/O على الـ hot path
- **Performance budgets & testing:** budget محدّد، regression testing، load/stress/soak/spike testing
- **Perceived performance:** optimistic UI، skeleton screens، progressive/streaming rendering، prefetching
- **Mobile/low-bandwidth:** أداء على شبكات ضعيفة وأجهزة متوسطة

### الأسئلة الإجبارية (enterprise)

- ما **الأداء المطلوب لهذا المسار تحديداً**؟ (checkout/search حرجة؛ admin report لا) — هل الأداء مهم هنا أصلاً؟
- ما الـ **budget**: p95/p99 latency target؟ هل نقيس الـ **tail** أم نختبئ خلف المتوسط؟
- أين الـ **N+1** والـ blocking I/O على الـ hot path؟ هل الـ hot queries مفهرسة؟
- **Frontend:** ما LCP/INP/CLS؟ حجم الـ bundle؟ هل يوجد code splitting/lazy loading؟
- هل يمكن تحويل عمل ثقيل إلى **async** (queue) خارج مسار الـ request؟
- هل نستخدم **perceived performance** (optimistic UI، skeletons، streaming) حيث لا يمكن تسريع الفعلي؟
- **قِس قبل أن تحسّن** — هل التحسين مبنيّ على قياس أم تخمين (premature optimization)؟

### 🎭 توزيع الأدوار

- **🟢 ENG:** algorithmic efficiency، query optimization، caching، N+1، async offloading
- **🟢 UX:** Core Web Vitals، perceived performance، optimistic UI، progressive loading، mobile
- **🟢 OPS:** infra performance، CDN، load testing، capacity، performance monitoring/APM
- **🔵 CTO:** معمارية الأداء، latency budget، sync vs async، edge strategy، caching strategy
- **🔵 PM:** الأداء كـ feature (أي مسارات يجب أن تكون سريعة)، perf SLIs، أولوية السرعة
- **🔵 GRW:** الأداء → التحويل (كل 100ms تكلّف conversion؛ السرعة رافعة نمو مثبتة)
- **🔵 BA:** performance NFRs من العمل (response time، أحجام المعاملات)
- **· BD:** performance SLAs في عقود enterprise
- **· SEC:** ألا تقتل ضوابط الأمان الأداء (crypto/WAF overhead)، ولا يقتل الأداء الأمان

**Anti-patterns:** قياس المتوسط بدل p95/p99 • premature optimization (تحسين بلا قياس) • N+1 queries • blocking I/O على hot path • bundle ضخم بلا splitting • تجاهل perceived performance • تحسين مسار لا يهم (admin) وإهمال المسار الحرج (checkout) • O(n²) مخفيّ.

---

## 🎬 كيف تُشغّل الـ Gate (بلا بيروقراطية)

1. **امسح** المصفوفة الرئيسية أعلاه — أي محاور load-bearing لهذا القرار؟ (عادةً 2-4)
2. **لكل load-bearing:** افتح قسمه أعلاه، اطرح أسئلته الإجبارية، وحدّد **أي دور** يجب أن يساهم (من توزيع الأدوار)
3. **البقية:** `N/A + سبب سطر واحد` — إسقاط واعٍ لا صمت
4. **عند تعارض محورين:** trade-off واعٍ صريح (نضحّي بـ X لصالح Y لأن... — مثل Cost مقابل Availability)
5. **فعّل الأدوار المعنية:** إن كان Security load-bearing → اقرأ [Cyber-Security.md](Roles/Cyber-Security.md)؛ إن كان Observability/Availability/Reliability → [DevOps-SRE.md](Roles/DevOps-SRE.md)؛ وهكذا

**⚠️ Anti-pattern للـ gate نفسه:** فرض الثمانية بالتساوي على قرار تافه = over-engineering وطقوس. الهدف **وعي هندسي enterprise**، لا نموذج بيروقراطي يُملأ آلياً.
