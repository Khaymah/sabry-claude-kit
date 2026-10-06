# 🚫 Anti-patterns Registry

> سجل مركزي للأخطاء المتعلَّمة (Gotchas) عبر كل المشاريع.
> الهدف: لا تكرر نفس الخطأ بعد 3 شهور.

## متى تُقرأ ملفات هذا المجلد؟

- عند بدء مهمة في domain لها anti-patterns موثّقة
- عند مراجعة كود (Review mode)
- عند debugging مشكلة تشبه نمطاً سابقاً
- بعد incident — تحقق إذا كان الخطأ موثّقاً

## بنية كل anti-pattern

```markdown
# Anti-pattern: [الاسم القصير]

## What
وصف مختصر — جملة واحدة.

## Why it's wrong
لماذا هذا خطأ؟ ما الـ consequences؟

## When seen (سياق)
- المشروع/الـ stack: [...]
- التاريخ: [YYYY-MM]
- التكلفة (إن وُجدت): [downtime, lost data, hours debugging]

## Correct Approach
الطريقة الصحيحة + كود مثال.

## Detection
كيف نكتشف هذا النمط مبكراً؟
- Linter rule
- Code review checklist
- Test pattern

## Related
[anti-patterns أخرى ذات صلة]
```

## التصنيفات

### 🔧 Framework Gotchas

موثّقة جزئياً في `CLAUDE.md` (القسم 6.3). انقل تفاصيل كل واحدة هنا:

- [ ] `hono-response-headers.md` — `c.header()` لا يعمل مع `new Response()`
- [ ] `drizzle-update-without-where.md` — `update()` بدون `.where()` يحدّث الكل
- [ ] `drizzle-soft-delete-missing.md` — `WHERE` بدون `IsDeleted = false`
- [ ] `typescript-export-type-runtime.md` — `export type` للقيمة → undefined
- [ ] `fastify-send-in-proxy.md` — `res.send()` يكسر proxy context
- [ ] `bun-dotenv-redundant.md` — لا تضيف `dotenv/config` في Bun

### 🏗️ Architecture Mistakes

- [ ] `premature-microservices.md` — Microservices قبل team > 20
- [ ] `god-service.md` — Service واحد يفعل كل شيء
- [ ] `tight-db-coupling.md` — Modules تشترك في schemas
- [ ] `event-storming-skipped.md` — تصميم بدون فهم domain events

### 🔐 Security

- [ ] `secrets-in-git.md` — Commit .env / credentials
- [ ] `sql-injection-string-concat.md` — String concatenation في queries
- [x] [`joi-validated-value-discarded.md`](joi-validated-value-discarded.md) — ميدلوير تحقّق يحسب `value` المُحوَّلة ثم يهملها ⇒ `.default()`/`.trim()`/تحويل النوع/`.custom()` كلها بلا أثر بينما تبدو عاملة. **رُصدت في Master-V** — والـ linter كان قد رصدها وأُسكِت
- [x] [`impossible-value-as-match-nothing.md`](impossible-value-as-match-nothing.md) — قيمة مستحيلة (`999…`) بدل `1 = 0` أو `NULL` — **رُصدت 3 مرات في Master-V**: خطأ SQL حيّ + سطح حقن + 335 وحدة تعرض بيانات خاطئة
- [ ] `jwt-in-localstorage.md` — XSS exposure
- [ ] `cors-wildcard.md` — `Access-Control-Allow-Origin: *` مع credentials
- [ ] `rate-limit-missing.md` — No rate limiting → DDoS / brute force
- [ ] `webhook-no-hmac.md` — Webhook بدون signature verification

### 💾 Database

- [ ] `n-plus-one-queries.md` — Loop يضرب DB في كل iteration
- [ ] `missing-indexes.md` — Slow queries بسبب missing indexes
- [ ] `varchar-instead-of-text.md` — VARCHAR في PostgreSQL بدون داعٍ
- [ ] `migration-not-reversible.md` — Migration بدون down

### 🎨 Frontend

- [ ] `no-loading-state.md` — UI يفترض البيانات موجودة
- [ ] `hardcoded-colors.md` — Hex codes بدلاً من design tokens
- [ ] `no-error-boundary.md` — React error يكسر الصفحة كلها
- [ ] `infinite-rerender.md` — useEffect dependencies خاطئة

### 🚀 DevOps

- [ ] `latest-tag-in-prod.md` — Docker image `:latest` في production
- [ ] `manual-server-changes.md` — Snowflake servers (no IaC)
- [ ] `friday-deploys.md` — Deploy قبل weekend
- [ ] `untested-backups.md` — Backup بدون restore test
- [ ] `single-region.md` — Single region = SPOF
- [ ] `no-runbook.md` — Alert بدون procedure

### 💼 Business / Process

- [ ] `no-deal-registration.md` — Channel conflict بسبب عدم وجود نظام تسجيل
- [ ] `verbal-scope.md` — Scope agreement شفهي → خلاف لاحق
- [ ] `customer-concentration.md` — > 30% revenue من client واحد
- [ ] `free-pilot-no-exit.md` — Pilot مفتوح بدون deadline

## كيف نضيف anti-pattern جديد؟

1. **بعد كل incident أو bug** — اسأل: هل هذا نمط؟
2. أنشئ ملف في المجلد المناسب
3. اتبع البنية أعلاه (الـ "When seen" مهمة — اذكر التاريخ والمشروع)
4. أضف صف في القسم المناسب من هذا README
5. لو الـ pattern يستحق automation: أضف linter rule / pre-commit hook

## القاعدة الذهبية

> **إذا اكتشفت نفس الخطأ مرتين في 6 شهور — وثّقه هنا.**
> إذا كان مرة واحدة، لكنه كلّفك ≥ يوم work — وثّقه.
