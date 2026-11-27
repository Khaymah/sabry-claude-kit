# Playbooks — router

Three axes: **situations** (backend, frontend, security, devops: "I am building X"), **qualities** (maintainability, observability… : how any code must be), **architecture and practices** (how we design and work). Atomic files: one situation, one decision, three levels, one way to verify it. **Never read this folder wholesale.**

## How to use

1. Writing or reviewing code: read `quality/BASELINE.md` (one file, all qualities, per level); before calling it done, run the Detect column of `quality/TRAPS.md` on what you touched.
2. Find the domain below from the task (keywords are matched in English or Arabic).
3. Read that domain's `INDEX.md` and pick **1–3 files** whose "Situation" matches the task. Check each file's "Skip when" first.
4. **Pick the project's level** (below) and apply that level's rules plus every level under it. Never apply a higher level "to be safe": that is the over-engineering this step exists to stop.
5. Handle every row of the file's **Edge cases** that the feature can actually meet, and run that level's **Verify** items before you call the work done.
6. Report: `Playbooks: backend/auth/password-reset (Standard)`, plus any edge case you deliberately left out and why.
7. The project's own code and the owner's profile win over a playbook. A playbook wins over your general habit.
8. No matching file → work as usual and say "no playbook" in the report; don't invent one.

## Project level

Read it from `.agents/memory/` (`Level: …`). Not recorded → infer it from the signals; if the signals conflict and the choice changes the work, ask the owner once with `AskUserQuestion` and record the answer in `.agents/memory/`.

| Level | Signals |
|---|---|
| **Minimum** | Prototype, demo, MVP to validate an idea, internal tool for a few people, no real money, no sensitive personal data |
| **Standard** | The default for anything in production with real users or a paying client |
| **Advanced** | Money at volume or stored balances, sensitive or regulated data (health, finance, children), a public API for third parties, several server instances, an enterprise client with an SLA |

A single topic can sit above the project's level when its own trigger says so (a Minimum MVP that takes card payments uses Standard in `money.md`). It never sits below Minimum: Minimum holds the security and data-loss floor.

## Domains

| Domain | INDEX | Keywords |
|---|---|---|
| Backend | `backend/INDEX.md` | API · endpoint · auth · login · password · session · schema · migration · money · payment · webhook · queue · job · upload · cache · rate limit · باك اند · تسجيل دخول · فلوس · دفع · رفع ملفات |
| Frontend | `frontend/INDEX.md` | form · state · fetching · routing · i18n · RTL · a11y · performance · فورم · واجهة · عربي |
| Security | `security/INDEX.md` | secrets · headers · CORS · CSRF · XSS · injection · permissions · PII · أمان · صلاحيات |
| Qualities | `quality/INDEX.md` | SOLID · clean code · maintainability · refactor · tech debt · logging · monitoring · metrics · alerts · Sentry · tracing · errors · retries · shutdown · uptime · scaling · performance · slow · tests · cost · نظافة الكود · مراقبة · لوجز · أداء · بطء · اختبارات |
| Architecture | `architecture/INDEX.md` | structure · layers · modules · monolith · microservices · events · contract · design patterns · هيكلة · معمارية |
| Practices | `practices/INDEX.md` | git · branch · PR · review · CI · docs · README · dependency · feature flag · release · rollback · مراجعة كود · توثيق |
| DevOps | `devops/INDEX.md` | deploy · VPS · Nginx · TLS · backup · logs · monitoring · CI · نشر · سيرفر · باك اب |
| AI features | `ai/INDEX.md` | LLM · Claude · prompt · RAG · embeddings · chatbot · prompt injection · AI cost · evals · ذكاء اصطناعي · شات بوت |
| Business domains | `domains/INDEX.md` | payment gateway · Paymob · Fawry · InstaPay · wallet · installments · payout · reconciliation · notifications · SMS · WhatsApp · push · billing · subscription · coupon · invoice · refund · VAT · inventory · stock · transfer · booking · appointment · cart · checkout · order status · shipping · returns · loyalty · اشتراك · فاتورة · مخزن · جرد · حجز · مواعيد · سلة · شحن · مرتجعات |

Stack-specific rules stay in `Stacks/`; a playbook links to them instead of repeating them.
