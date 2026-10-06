---
name: project-audit
description: Performs a comprehensive multi-dimensional audit of a code project — covering security, code quality, performance, and architecture equally — and produces a structured Arabic Markdown report. Each finding includes (1) the problem, (2) how to fix it, (3) why this fix vs alternatives, and (4) how to prevent it in future projects. Use this skill whenever the user asks to audit, review, inspect, or analyze a project, codebase, or repository for issues; whenever they say "تحقق", "فحص", "مراجعة", "أوديت شامل", "code review", "security review"; or asks to find all the problems, vulnerabilities, or bugs in their code. Also trigger when the user uploads a project (zip, folder, or multiple files) and asks what is wrong with it, how it can be improved, or whether it is production-ready — even without explicitly using the word "audit".
---

# Project Audit Skill (تحقق شامل للمشروع)

A skill for conducting a thorough, multi-dimensional audit of a software project and producing a structured Arabic report.

## Goal

Produce one Markdown file (in Arabic) that gives the developer:
1. A clear inventory of every real problem in the project — security, code quality, performance, architecture — with no padding and no fabricated issues.
2. For each issue: the fix, the reasoning behind that fix, and a generalizable lesson they can carry to future projects.

The report is the deliverable. Everything else in the workflow exists to make the report accurate and useful.

---

## Workflow

The audit runs in four phases. Don't skip ahead — early phases inform later ones.

### Phase 1 — Reconnaissance (استكشاف المشروع)

Before opening any source file, build a mental map of what you're auditing.

1. **List the project tree** (excluding `node_modules/`, `.git/`, `vendor/`, `dist/`, `build/`, `.next/`, `target/`, `__pycache__/`, lock files, and other generated/vendored content).
2. **Identify the stack**: language(s), framework(s), runtime, database, build system. Look at `package.json`, `requirements.txt`, `Gemfile`, `pom.xml`, `Cargo.toml`, `go.mod`, etc.
3. **Identify the project type**: web API, full-stack app, CLI tool, library, mobile app, infra config, etc. The type determines which threats matter most.
4. **Find the entry points**: `main.*`, `index.*`, route definitions, request handlers, CLI command parsers, background workers, cron jobs.
5. **Find configuration and secret-handling code**: `.env*`, `config/`, settings files, anything that reads `process.env` / `os.environ`.

Output of this phase (internal, not in the report yet): a short summary of the stack and where the critical code lives. This drives where you spend audit time.

### Phase 2 — Multi-dimensional scan (الفحص متعدد الأبعاد)

Walk the source files systematically. For each substantive file, run it past all four pillars below. Don't audit one pillar at a time across the whole project — that wastes context. Audit each file across all four pillars while you have it open.

Excluded from scanning: vendored code, generated code, minified bundles, test fixtures (unless they leak secrets), migrations (unless logic-bearing).

**The four pillars are weighted equally.** Do not let security findings crowd out architectural ones or vice versa. A poorly factored module that no one can maintain is just as worth reporting as a missing input validation check.

See "Audit checklists" below for what to look for in each pillar.

### Phase 3 — Cross-file & deep-dive analysis (التعمّق)

After the file-by-file scan, step back and look at the project holistically:

- **Patterns**: Is the same mistake repeated in many places? That's one finding, not twenty. Note the pattern and list affected files.
- **Cross-cutting concerns**: Authentication, error handling, logging, configuration loading, database access — these usually span the project. Audit them as systems, not as individual files.
- **Missing pieces**: What *should* be there but isn't? No tests? No input validation layer? No rate limiting on a public API? No error monitoring? Absence is a finding.
- **Dependency hygiene**: Outdated packages, packages with known CVEs, abandoned/unmaintained deps, suspiciously rare packages (supply-chain risk).

### Phase 4 — Write the report (كتابة الريبورت)

Compile findings into the exact report format below. Write the report in Arabic. Save it to `/mnt/user-data/outputs/audit-report.md` (or a descriptive filename if the project has a name) and present it to the user via `present_files`.

---

## Audit checklists

Use these as prompts, not as a checklist to mechanically tick off. The goal is to *think* about each axis, not to produce a finding under every bullet.

### 🔒 Security (الأمن)

- **Injection vectors**: SQL/NoSQL injection, command injection, LDAP injection, template injection (SSTI), XPath injection. Look for string concatenation into queries/commands/templates.
- **Cross-site issues** (web apps): XSS (reflected, stored, DOM), CSRF (missing tokens or SameSite), open redirects, clickjacking (missing frame-ancestors / X-Frame-Options).
- **Authentication & sessions**: Weak password storage (no bcrypt/argon2/scrypt, low cost factor), predictable tokens, missing session expiration, JWT misuse (e.g., `alg: none`, secrets in client, no expiry).
- **Authorization**: Missing access checks on endpoints, IDOR (user can change an ID in a URL to access someone else's data), privilege escalation paths, broken multi-tenancy isolation.
- **Secrets in code**: API keys, DB passwords, private keys, tokens hardcoded or committed. Check `.env*` files in the tree, hardcoded strings, default credentials.
- **Cryptography**: Use of MD5/SHA1 for security, ECB mode, hardcoded IVs, custom crypto, weak random (using `Math.random`/`rand` for tokens).
- **Input validation**: Trusting user input (path traversal, file upload type/size checks, deserialization of untrusted data — pickle, YAML.load, Java deserialization).
- **Output handling**: Unescaped output in HTML/SQL/shell, content-type sniffing risks, missing CORS configuration or overly permissive (`*` with credentials).
- **Dependencies**: Known-vulnerable versions (check against advisories), packages with known supply-chain compromise.
- **Insecure defaults**: Debug mode in production, verbose error pages leaking stack traces, default admin credentials, permissive file permissions.
- **Logging & secrets**: PII/secrets written to logs, full request bodies logged, tokens echoed in error messages.

### 🧹 Code quality (جودة الكود)

- **Bugs**: Off-by-one errors, null/undefined dereferences, race conditions in async code, incorrect error handling (swallowed exceptions, generic catch-all, errors converted to nulls), wrong comparison operators (`==` vs `===`, equality on floats), resource leaks (unclosed files/connections/streams).
- **Error handling**: Missing error handling at boundaries (network, filesystem, DB). Returning `null` to mean "error" without documentation. `catch` blocks that log and continue when they shouldn't. Inconsistent error shapes across the codebase.
- **Dead code & duplication**: Unused functions/files/imports, commented-out code in committed source, copy-pasted blocks that should be extracted.
- **Complexity**: Functions doing too much, deeply nested conditionals, parameter lists too long, classes acting as god-objects. Note specific functions/files with the worst offenders.
- **Naming & readability**: Misleading names (function named `validate` that mutates), abbreviations that obscure meaning, inconsistent conventions across the codebase.
- **Comments & docs**: Comments that contradict the code (a strong bug signal — one of them is wrong), missing docs on public APIs, TODOs/FIXMEs that have outlived their usefulness.
- **Type safety**: Excessive use of `any` / `dynamic` / untyped dicts in projects that should have stronger typing. Missing return types on public functions.
- **Tests**: No tests at all on critical paths, tests that don't actually assert anything, brittle tests coupled to implementation, flaky time/network-dependent tests, no integration tests for important flows.

### ⚡ Performance (الأداء)

- **Database**: N+1 query patterns (loop fetching related records), missing indexes on filter/join columns, SELECT * in hot paths, missing pagination on potentially-large result sets, transactions held open across slow operations.
- **Algorithmic**: O(n²) where O(n) is achievable, nested loops over the same large data, sorting in inner loops, recomputing the same value repeatedly.
- **I/O & blocking**: Synchronous I/O in async/event-loop code, blocking the main thread, missing batching (one HTTP request per item instead of bulk).
- **Memory**: Loading whole large files instead of streaming, retaining references that should be GC'd, large objects kept in module scope unnecessarily.
- **Caching**: Missing caching on expensive deterministic computation, missing HTTP caching headers, cache invalidation bugs.
- **Frontend (if applicable)**: Large unsplit bundles, unoptimized images, render-blocking resources, re-renders triggered by unstable references, missing memoization where it matters, hydration mismatches.
- **Network**: Chatty APIs (many small calls where one batched call would do), missing compression, missing connection pooling.

### 🏛️ Architecture (المعمارية)

- **Separation of concerns**: Business logic mixed with framework code, controllers/handlers doing data access directly, DB queries inside view templates, side effects in pure-looking functions.
- **Coupling**: Modules that depend on each other's internals, circular dependencies, hidden coupling via shared mutable state.
- **Boundaries**: No clear layer boundaries (e.g., domain ↔ infrastructure), domain types leaking framework types (ORM models used as API responses without DTOs).
- **Scalability**: In-memory state in code that's expected to scale horizontally, sticky-session assumptions, shared filesystems assumed, missing idempotency on side-effectful endpoints.
- **Configuration**: Magic numbers hardcoded throughout, configuration scattered across many files, no clear environment separation, secrets and feature flags mixed.
- **Dependency direction**: High-level modules depending on low-level modules (rather than both depending on abstractions), domain depending on infrastructure.
- **Error/result propagation**: Errors propagated as exceptions in some places and return values in others without convention, lost context as errors bubble up.
- **Observability**: Critical operations with no logs, no structured logging, no correlation IDs across async boundaries, no metrics on important business operations.

---

## Severity classification (تصنيف الخطورة)

Use these five levels and the emoji prefixes — the user's report grouping depends on them.

- 🔴 **حرج (Critical)** — Active exploitability, data loss, production outages possible, or a security flaw that can be triggered remotely without authentication. Examples: SQL injection, hardcoded admin password, broken authentication.
- 🟠 **عالي (High)** — Real exploitability with prerequisites, or a bug that will affect users in production under normal conditions. Examples: IDOR requiring an authenticated user, N+1 query on a hot endpoint, missing CSRF on state-changing form.
- 🟡 **متوسط (Medium)** — Real problem but limited impact, or a code-quality issue that will slow future development. Examples: outdated dependency without a known critical CVE, complex function that needs refactoring, inconsistent error handling.
- 🟢 **منخفض (Low)** — Genuine improvement but not urgent. Examples: missing tests on a non-critical path, opportunity for caching, inconsistent naming.
- ⚪ **للعلم (Info)** — Observations, not problems. Examples: "this pattern is repeated 8 times — consider extracting", "no CI configured yet".

**Calibrate honestly.** Inflating severity to make findings look more urgent destroys trust. If most findings are low/medium, that's a fine outcome.

---

## Report format (شكل الريبورت)

ALWAYS use this exact template. The report is in Arabic; code, file paths, and technical terms stay in their original form.

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

## Principles (مبادئ تحكم جودة التقرير)

These principles matter more than any checklist.

1. **Impact over volume.** Five real, well-explained findings beat fifty nitpicks. If you find yourself padding the report, stop.

2. **Be specific, never generic.** Cite `file:line`. Show the actual offending code. "Improve error handling" is useless; "in `src/api/users.js:42`, the catch block swallows the DB error and returns 200 — change it to log and return 500" is useful.

3. **Distinguish bugs from risks from style.** Tag mentally (or explicitly in the finding):
   - 🐛 Bug — definitely wrong, will produce incorrect behavior
   - ⚠️ Risk — could be wrong under certain conditions
   - 💅 Style — preference, not correctness
   Mostly report bugs and risks. Style only when it has real maintainability impact.

4. **Acknowledge tradeoffs.** A "best practice" isn't universally best. If the project's context legitimately justifies the current approach, say so or pick a different finding. In section 3 ("لماذا هذا الحل"), genuinely engage with alternatives — don't write a paragraph that just restates the fix.

5. **Verify before claiming.** If you're not sure something is a real issue, either dig deeper to confirm, or mark it explicitly: "محتاج تأكيد — يحتمل أن X يحدث في حالة Y". A confidently wrong finding burns more trust than a hedged correct one.

6. **No fabricated findings.** Never invent issues to fill out a section. If security has only one finding and performance has eight, that's the truthful report.

7. **The "prevention" section must be actionable.** Section 4 is the most valuable part of each finding — it's where the user learns something durable. "Be more careful" is not actionable. "Add `eslint-plugin-security`" is. "Move all DB access behind a repository interface" is. "Adopt parameterized queries everywhere; ban string concatenation in queries via a lint rule" is.

8. **Group repeated mistakes.** If the same bug appears in 12 files, write one finding listing all 12 locations — don't pad with 12 nearly identical entries.

9. **Show new code in full.** In section 2 ("الحل"), don't write a diff that's hard to read in isolation. Show the post-fix code in full so the user can paste it in.

10. **Arabic for prose, English for code.** The narrative is in Arabic. Code blocks, file paths, function/variable names, framework names, and standard technical acronyms (SQL, CSRF, JWT, etc.) stay as-is.

---

## Handling edge cases

- **Project is too large to audit exhaustively.** Say so in the executive summary, then sample strategically: all entry points, all auth/authz code, all DB access, all input handlers, plus a representative sample of the rest. Note in "ما لم يتم فحصه" which parts you didn't reach.

- **User provided only a partial project / single file.** Audit what's provided. Note explicitly that you can only flag what's visible — some classes of issue (e.g., missing authorization checks) can only be confirmed against the surrounding code.

- **No project provided yet.** Don't make one up. Ask the user to share the code (zip, files, or paste).

- **Audit turns up almost nothing.** Report honestly. A short report saying "the project is in good shape; here are 3 minor observations" is a valid outcome.

- **Findings conflict with each other.** (E.g., a performance fix that creates a security issue.) Note the conflict in section 3 and recommend the path that best fits the project's apparent priorities, or surface the choice to the user.