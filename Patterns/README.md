# 🧩 Patterns Library

> مكتبة حلول قابلة لإعادة الاستخدام (How-tos) عبر المشاريع.

## الفكرة

عندما تتكرر مهمة في أكثر من مشروع (مثل "كيف نضيف module جديد للـ Server؟")، وثّقها هنا مرة واحدة، ثم أحِل لها من أي مشروع.

## متى تُقرأ ملفات هذا المجلد؟

- عند تكرار طلب مماثل في مشروع آخر
- عند بدء مهمة موجود لها pattern معروف
- عند تدريب developer جديد على الـ codebase

## بنية الملف المثالية

```markdown
# Pattern: [اسم المهمة]

## Use Case
متى نستخدم هذا الـ pattern؟ + متى لا نستخدمه؟

## Prerequisites
- [Stack required]
- [أدوات مطلوبة]
- [permissions]

## Steps
1. Step 1 — concrete action
2. Step 2 — ...
...

## Code Example
\`\`\`ts
// مثال فعلي قابل للنسخ
\`\`\`

## Verification
- [ ] Test 1
- [ ] Test 2

## Common Pitfalls
- ⚠️ خطأ 1 + كيف تتجنبه
- ⚠️ خطأ 2

## Related Patterns
- [Pattern X] — لو تحتاج كذلك...
```

## Patterns مقترحة (للإضافة لاحقاً)

### Server Patterns
- [ ] `add-new-module.md` — إضافة module جديد للـ Modular Monolith
- [ ] `add-translation-table.md` — جدول ترجمة + Drizzle schema + i18n
- [ ] `add-api-endpoint.md` — endpoint جديد (route + validator + handler + docs)
- [ ] `add-payment-provider.md` — integration دفع جديد
- [ ] `add-ai-provider.md` — integration AI model جديد
- [ ] `add-webhook-handler.md` — استقبال webhooks بأمان (HMAC + idempotency)

### Client Patterns
- [ ] `add-new-page.md` — صفحة Next.js جديدة (+ i18n + SEO + loading)
- [ ] `add-dashboard-widget.md` — widget جديد للـ dashboard
- [ ] `add-form-with-validation.md` — react-hook-form + zod
- [ ] `add-chart.md` — Recharts integration
- [ ] `add-rtl-component.md` — component يدعم RTL

### Infrastructure Patterns
- [ ] `setup-new-project.md` — bootstrap مشروع جديد بالـ stack الافتراضي
- [ ] `add-cron-job.md` — scheduled task (BullMQ / native)
- [ ] `add-monitoring.md` — Sentry + Grafana setup
- [ ] `deploy-to-vps.md` — Docker + Caddy + GitHub Actions

### Business Patterns
- [ ] `pricing-tier-design.md` — تصميم tiers + billing
- [ ] `client-onboarding.md` — flow استقبال عميل جديد
- [ ] `partnership-proposal.md` — template لـ partnership deck

## كيف نضيف pattern جديد؟

1. أنشئ ملف `<category>-<action>.md` في هذا المجلد
2. اتبع البنية أعلاه
3. أضف صف في القسم المناسب من هذا الـ README
4. اربط من ملفات الأدوار المعنية لو applicable
