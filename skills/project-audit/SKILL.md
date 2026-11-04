---
name: project-audit
description: Comprehensive audit of a code project across security, quality, performance and architecture, producing a structured Arabic Markdown report (problem, fix, why, prevention per finding). Use when asked to audit/review a codebase, find problems or vulnerabilities, or judge production-readiness; also "تحقق" / "فحص" / "مراجعة" / "أوديت شامل" / "code review".
---

# Project Audit (تحقق شامل للمشروع)

Reply in the owner's language (profile; default Egyptian Arabic). The report itself is always written in Arabic.

## Goal

Produce one Arabic Markdown file giving the developer:
1. An inventory of every real problem (security, code quality, performance, architecture), with no padding and no fabricated issues.
2. For each issue: the fix, the reasoning behind it, and a generalizable lesson for future projects.

The report is the deliverable; everything else exists to make it accurate and useful.

---

## Workflow

Four phases, in order; early phases inform later ones.

### Phase 1: Reconnaissance (استكشاف المشروع)

Before opening any source file, map what you're auditing.

1. **List the project tree** (exclude `node_modules/`, `.git/`, `vendor/`, `dist/`, `build/`, `.next/`, `target/`, `__pycache__/`, lock files, other generated/vendored content).
2. **Identify the stack**: language(s), framework(s), runtime, database, build system (`package.json`, `requirements.txt`, `Gemfile`, `pom.xml`, `Cargo.toml`, `go.mod`, etc.).
3. **Identify the project type**: web API, full-stack app, CLI, library, mobile app, infra config, etc. The type decides which threats matter most.
4. **Find entry points**: `main.*`, `index.*`, route definitions, request handlers, CLI parsers, background workers, cron jobs.
5. **Find configuration and secret-handling code**: `.env*`, `config/`, settings files, anything reading `process.env` / `os.environ`.

Output (internal, not in the report): a short stack summary and where the critical code lives. It drives where you spend audit time.

### Phase 2: Multi-dimensional scan (الفحص متعدد الأبعاد)

Walk the source files systematically. Run each substantive file past all four pillars while it's open; don't audit one pillar at a time across the whole project (wastes context).

Excluded: vendored code, generated code, minified bundles, test fixtures (unless they leak secrets), migrations (unless logic-bearing).

**The four pillars are weighted equally.** Don't let security findings crowd out architectural ones or vice versa; an unmaintainable module is as worth reporting as a missing validation check.

### Phase 3: Cross-file and deep-dive analysis (التعمّق)

After the file-by-file scan, look at the project holistically:

- **Patterns**: the same mistake in many places is one finding, not twenty. Note the pattern and list affected files.
- **Cross-cutting concerns**: authentication, error handling, logging, config loading, database access. Audit them as systems, not individual files.
- **Missing pieces**: what *should* be there but isn't (tests, input validation layer, rate limiting on a public API, error monitoring). Absence is a finding.
- **Dependency hygiene**: outdated packages, known CVEs, abandoned deps, suspiciously rare packages (supply-chain risk).

### Phase 4: Write the report (كتابة الريبورت)

Compile findings into the exact format below, in Arabic. Save to `/mnt/user-data/outputs/audit-report.md` (or a descriptive filename if the project has a name) and present it via `present_files`.

---

## Audit checklists

Prompts to *think* about each axis, not boxes to tick; don't force a finding under every bullet.

### 🔒 Security (الأمن)

- **Injection**: SQL/NoSQL, command, LDAP, template (SSTI), XPath. Look for string concatenation into queries/commands/templates.
- **Cross-site** (web): XSS (reflected, stored, DOM), CSRF (missing tokens or SameSite), open redirects, clickjacking (missing frame-ancestors / X-Frame-Options).
- **Authentication and sessions**: weak password storage (no bcrypt/argon2/scrypt, low cost), predictable tokens, no session expiry, JWT misuse (`alg: none`, secrets in client, no expiry).
- **Authorization**: missing access checks, IDOR, privilege escalation paths, broken multi-tenancy isolation.
- **Secrets in code**: API keys, DB passwords, private keys, tokens hardcoded or committed; `.env*` files in the tree; default credentials.
- **Cryptography**: MD5/SHA1 for security, ECB mode, hardcoded IVs, custom crypto, weak random (`Math.random`/`rand` for tokens).
- **Input validation**: trusting user input (path traversal, upload type/size checks, deserializing untrusted data: pickle, YAML.load, Java deserialization).
- **Output handling**: unescaped output in HTML/SQL/shell, content-type sniffing, missing or overly permissive CORS (`*` with credentials).
- **Dependencies**: known-vulnerable versions (check advisories), known supply-chain compromises.
- **Insecure defaults**: debug mode in production, verbose error pages leaking stack traces, default admin credentials, permissive file permissions.
- **Logging and secrets**: PII/secrets in logs, full request bodies logged, tokens echoed in errors.

### 🧹 Code quality (جودة الكود)

- **Bugs**: off-by-one, null/undefined dereference, async race conditions, bad error handling (swallowed exceptions, catch-all, errors turned into nulls), wrong comparisons (`==` vs `===`, float equality), resource leaks (unclosed files/connections/streams).
- **Error handling**: missing at boundaries (network, filesystem, DB); `null` meaning "error" undocumented; `catch` that logs and continues when it shouldn't; inconsistent error shapes.
- **Dead code and duplication**: unused functions/files/imports, commented-out code, copy-pasted blocks to extract.
- **Complexity**: functions doing too much, deep nesting, long parameter lists, god-objects. Name the worst offenders.
- **Naming and readability**: misleading names (a `validate` that mutates), obscuring abbreviations, inconsistent conventions.
- **Comments and docs**: comments contradicting code (strong bug signal; one is wrong), missing docs on public APIs, stale TODOs/FIXMEs.
- **Type safety**: excessive `any` / `dynamic` / untyped dicts where stronger typing is expected; missing return types on public functions.
- **Tests**: none on critical paths, tests asserting nothing, brittle tests coupled to implementation, flaky time/network tests, no integration tests for important flows.

### ⚡ Performance (الأداء)

- **Database**: N+1 queries, missing indexes on filter/join columns, SELECT * in hot paths, no pagination on potentially large results, transactions held open across slow operations.
- **Algorithmic**: O(n²) where O(n) is possible, nested loops over the same large data, sorting in inner loops, recomputing the same value.
- **I/O and blocking**: synchronous I/O in async/event-loop code, blocking the main thread, missing batching (one HTTP request per item instead of bulk).
- **Memory**: loading whole large files instead of streaming, retained references that should be GC'd, large objects needlessly in module scope.
- **Caching**: missing on expensive deterministic computation, missing HTTP cache headers, invalidation bugs.
- **Frontend (if applicable)**: large unsplit bundles, unoptimized images, render-blocking resources, re-renders from unstable references, missing memoization where it matters, hydration mismatches.
- **Network**: chatty APIs (many small calls where one batched call would do), missing compression, missing connection pooling.

### 🏛️ Architecture (المعمارية)

- **Separation of concerns**: business logic mixed with framework code, handlers doing data access directly, DB queries in view templates, side effects in pure-looking functions.
- **Coupling**: modules depending on each other's internals, circular dependencies, hidden coupling via shared mutable state.
- **Boundaries**: no clear layer boundaries (domain <-> infrastructure), framework types leaking into the domain (ORM models as API responses without DTOs).
- **Scalability**: in-memory state where horizontal scaling is expected, sticky-session assumptions, shared-filesystem assumptions, no idempotency on side-effectful endpoints.
- **Configuration**: magic numbers, config scattered across files, no environment separation, secrets and feature flags mixed.
- **Dependency direction**: high-level modules depending on low-level ones (rather than both on abstractions), domain depending on infrastructure.
- **Error/result propagation**: exceptions in some places and return values in others without convention; context lost as errors bubble up.
- **Observability**: critical operations without logs, no structured logging, no correlation IDs across async boundaries, no metrics on key business operations.

---

## Severity classification (تصنيف الخطورة)

Use these five levels and emoji prefixes; the report grouping depends on them.

- 🔴 **حرج (Critical)**: active exploitability, data loss, possible production outage, or a flaw triggerable remotely without authentication. E.g. SQL injection, hardcoded admin password, broken authentication.
- 🟠 **عالي (High)**: real exploitability with prerequisites, or a bug that hits users in production under normal conditions. E.g. IDOR needing an authenticated user, N+1 on a hot endpoint, missing CSRF on a state-changing form.
- 🟡 **متوسط (Medium)**: real but limited impact, or a quality issue that slows future development. E.g. outdated dependency without a known critical CVE, complex function needing refactor, inconsistent error handling.
- 🟢 **منخفض (Low)**: genuine but not urgent. E.g. missing tests on a non-critical path, caching opportunity, inconsistent naming.
- ⚪ **للعلم (Info)**: observations, not problems. E.g. "this pattern repeats 8 times, consider extracting", "no CI configured yet".

**Calibrate honestly.** Inflating severity destroys trust; mostly low/medium findings is a fine outcome.

---

## Report format (شكل الريبورت)

ALWAYS use this exact template. The report is in Arabic; code, file paths and technical terms stay in their original form. The Arabic headings and bracketed placeholders below are owner-facing output; keep them.

```markdown
# تقرير التحقق الشامل — [اسم المشروع]

> **تاريخ التحقق:** YYYY-MM-DD
> **نوع المشروع:** [مثال: Node.js REST API + PostgreSQL]
> **التقنيات الأساسية:** [Express 4.x، Sequelize، Redis، …]
> **حجم الكود المفحوص:** [عدد الملفات/أسطر الكود تقريباً]

## الملخص التنفيذي

[فقرة قصيرة 3-5 أسطر: ما هو المشروع، ما هي الحالة العامة، ما هو أهم 2-3 أشياء يجب أن يعرفها صاحب المشروع فوراً.]

**إجمالي المشاكل:** N
- 🔴 حرج: N
- 🟠 عالي: N
- 🟡 متوسط: N
- 🟢 منخفض: N
- ⚪ للعلم: N

**أعلى ثلاث أولويات (افعلها أولاً):**
1. [SEV-XXX] [عنوان المشكلة]
2. [SEV-XXX] [عنوان المشكلة]
3. [SEV-XXX] [عنوان المشكلة]

---

## فهرس المشاكل

| الرقم | الخطورة | الفئة | العنوان | الملف |
|------|---------|------|---------|-------|
| SEV-001 | 🔴 حرج | أمن | … | src/auth.js:42 |
| SEV-002 | 🟠 عالي | أداء | … | src/api/users.js:120 |
| …      | …       | …    | …       | …             |

---

## المشاكل التفصيلية

### SEV-001 — 🔴 [عنوان المشكلة]

**الفئة:** أمن
**الملف(ات):** `src/auth.js:42-58`
**الخطورة:** حرج

#### 1. المشكلة

[وصف دقيق ومحدد لما هو خطأ. اذكر السلوك الفعلي، وما الذي يجعله مشكلة، وفي أي ظرف يظهر الأثر.]

```[لغة الكود]
// مقتطف الكود المشكل، مع رقم السطر إن أمكن
```

#### 2. الحل

[الحل الملموس، خطوة بخطوة. لو الحل عبارة عن تعديل كود، اعرض الكود الجديد كاملاً، لا diff فقط.]

```[لغة الكود]
// الكود بعد الإصلاح
```

#### 3. لماذا هذا الحل تحديداً؟

[لماذا اخترت هذا النهج. ما هي البدائل التي فكرت فيها ولماذا تم رفضها. ما هي المقايضات (tradeoffs). إذا كان السياق يبرر حلاً مختلفاً، اذكر ذلك.]

#### 4. كيف نتفادى هذه المشكلة مستقبلاً

[الدرس العام القابل للتطبيق على مشاريع أخرى. ليس مجرد "كن حذراً"، بل: قاعدة محددة، أو أداة ينبغي إضافتها، أو ممارسة هيكلية، أو فحص مؤتمت يمنع تكرار هذا النوع من الخطأ. مثال: "أضف ESLint plugin X"، أو "اجعل كل استعلام يمر عبر طبقة repository"، أو "أضف pre-commit hook لـ secret scanning".]

---

### SEV-002 — 🟠 [العنوان]

[نفس الهيكل]

---

[… وهكذا لكل المشاكل …]

## التوصيات المعمارية العامة

[إذا لاحظت أنماطاً متكررة أو استثمارات تحسينية كبرى لا تناسب صيغة "مشكلة واحدة"، اذكرها هنا في فقرات قصيرة. مثل: "غياب طبقة validation موحدة"، "النظر في فصل الـ domain logic عن طبقة الـ ORM"، إلخ.]

## ما لم يتم فحصه

[كن صريحاً بشأن النطاق. مثلاً: "لم يتم فحص ملفات الـ migrations التاريخية"، "لم يتم تشغيل فحص dependencies ضد قاعدة CVE حية".]
```

---

## Principles

These matter more than any checklist.

1. **Impact over volume.** Five real, well-explained findings beat fifty nitpicks. If you're padding, stop.
2. **Specific, never generic.** Cite `file:line` and show the offending code. "Improve error handling" is useless; "in `src/api/users.js:42` the catch swallows the DB error and returns 200; log and return 500" is useful.
3. **Distinguish bugs, risks, style.** Tag mentally or explicitly: 🐛 Bug (definitely wrong) · ⚠️ Risk (wrong under certain conditions) · 💅 Style (preference). Mostly report bugs and risks; style only with real maintainability impact.
4. **Acknowledge tradeoffs.** A "best practice" isn't universal. If context justifies the current approach, say so or pick another finding. In section 3 ("لماذا هذا الحل") genuinely engage with alternatives; don't just restate the fix.
5. **Verify before claiming.** Unsure it's real? Dig deeper, or mark it: "محتاج تأكيد — يحتمل أن X يحدث في حالة Y". A confidently wrong finding burns more trust than a hedged correct one.
6. **No fabricated findings.** Never invent issues to fill a section. One security finding and eight performance ones is a truthful report.
7. **Prevention must be actionable.** Section 4 is the most valuable part: "be more careful" isn't actionable; "add `eslint-plugin-security`", "move all DB access behind a repository interface", "use parameterized queries everywhere and ban string concatenation in queries via a lint rule" are.
8. **Group repeated mistakes.** The same bug in 12 files = one finding listing 12 locations.
9. **Show new code in full.** In section 2 ("الحل"), show the post-fix code in full, not a hard-to-read diff, so the user can paste it.
10. **Arabic for prose, English for code.** Narrative in Arabic; code blocks, file paths, function/variable names, framework names and standard acronyms (SQL, CSRF, JWT...) stay as-is.

---

## Edge cases

- **Project too large to audit exhaustively.** Say so in the executive summary, then sample strategically: all entry points, auth/authz code, DB access, input handlers, plus a representative sample of the rest. List unreached parts under "ما لم يتم فحصه".
- **Partial project / single file.** Audit what's provided; state that you can only flag what's visible (e.g. missing authorization checks can only be confirmed against surrounding code).
- **No project provided.** Don't make one up; ask the user to share the code (zip, files, or paste).
- **Almost nothing found.** Report honestly; "the project is in good shape; here are 3 minor observations" is valid.
- **Conflicting findings** (e.g. a performance fix that creates a security issue). Note the conflict in section 3 and recommend the path that best fits the project's apparent priorities, or surface the choice to the user.
