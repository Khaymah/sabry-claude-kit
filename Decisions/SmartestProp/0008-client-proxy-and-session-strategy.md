# ADR-0008: Client Middleware and Session — One Live proxy.ts (Locale + Direction), Bearer Tokens Kept, No PII Persisted

- **Status:** Accepted
- **Date:** 2026-09-04
- **Deciders:** Sabry
- **Project:** SmartestProp
- **Tags:** nextjs, auth, session, rtl, security
- **Related findings:** SEV-C-010 · SEV-C-039 · SEV-C-012 · SEV-C-013 · SEV-C-042 (Plans/Audit-2026-09-03)

## Context

- `proxy.ts` (اسم middleware في Next.js 16) هيكل من 4 أسطر لـ next-intl، بينما المنطق الفعلي (تحديد اللغة من الطلب) يعيش في `dashed.proxy.ts` الميت (81 سطراً).
- `<html>` بلا `dir` من الخادم ⇒ وميض LTR لكل تحميل عربي.
- الخروج/الخروج القسري مكرّر في 4 مواضع، 3 منها تتجاوز موجّه اللغة.
- `AuthStore` يحفظ PII (بريد، اسم، دور) في `localStorage` ولا يُبطلها في التبويبات الأخرى عند الخروج.
- حارس الأدمن قرار عميل من حالة قابلة للعبث؛ الخادم يفرض الدور على كل API (`Scope.Middleware` + `Admin.Routes`)، فالحارس تجميلي لا أمني.

القيود: الـ widget المضمَّن يستخدم Bearer عبر نطاقات مختلفة؛ إصدار «دردشة AI فقط» قريب (ADR-0004)؛ لا صفحات SSR مخصّصة بالمستخدم حالياً.

## Decision

1. **`proxy.ts` واحد حيّ:** يدمج منطق اللغة الصالح من `dashed.proxy.ts` ثم يُحذف الأخير؛ لا ملفات middleware ميتة.
2. **الاتجاه من الخادم:** `app/[locale]/layout.tsx` يضبط `<html lang={locale} dir={locale === "ar" ? "rtl" : "ltr"}>`.
3. **الجلسة تبقى Bearer** (access في الذاكرة + refresh في التخزين كما هو الآن)، مع: `persist` يحفظ التوكنات فقط لا PII (الملف الشخصي يُجلب من `/auth/me` عند الإقلاع)، وبثّ الخروج عبر `storage` event لباقي التبويبات، ودالة واحدة `NavigateToLogin(locale)` تستخدمها المواضع الأربعة.
4. **حماية الأدمن على الخادم فقط** (قائمة الآن)؛ حارس العميل يبقى لإخفاء الواجهة مع تعليق يوضّح أنه ليس ضابطاً أمنياً.
5. **الانتقال إلى httpOnly cookie مؤجَّل** إلى ADR منفصل عند ظهور حاجة فعلية لصفحات SSR مخصّصة أو متطلب امتثال.

## Considered Options

### Option 1: proxy.ts حيّ + dir من الخادم + Bearer بلا PII ← المختار
- **Pros:** أقل تغييراً، يغلق كل المشاكل المرصودة، لا يمسّ عقد المصادقة مع الـ widget والـ API الخارجي.
- **Cons:** لا حماية SSR للصفحات (مقبول: كل البيانات عبر API محمي؛ الصفحة الفارغة لا تكشف شيئاً).

### Option 2: httpOnly cookie من الخادم + تحقّق auth/role في proxy.ts
- **Pros:** لا توكن في JS، حماية SSR حقيقية، لا PII في التخزين بطبيعته.
- **Cons:** يغيّر عقد المصادقة عبر Server + Client + Widget (CORS credentials، CSRF، refresh عبر الكوكي، نطاقات الـ widget)؛ أسبوع عمل ومخاطر كسر الـ widget قبل الإصدار الأول.

## Rationale

المحاور الحاكمة: **Security** (PII في التخزين، وضوح حدود الحماية) و**Maintainability** (ملف middleware واحد، دالة خروج واحدة). Performance يُسقَط: فرق مهمل. Cost: الخيار المختار ساعات لا أسبوع. تأجيل الكوكي قرار واعٍ لا إهمال، ومسجَّل كمسار هجرة.

## Consequences

### Positive
- ✅ لا وميض LTR؛ لا PII في `localStorage`؛ الخروج يعمّ التبويبات خلال ثانية.
- ✅ ملف middleware واحد يُقرأ ويُختبر.

### Negative (Trade-offs المقبولة)
- ⚠️ طلب `/auth/me` إضافي عند إقلاع كل تبويب.
- ⚠️ حارس الأدمن في العميل يبقى قابلاً للتجاوز بصرياً (بلا أثر أمني).

### Risks
- 🚨 نسيان أن الحماية على الخادم عند إضافة route إداري جديد — Mitigation: `Admin.Routes.ts` يحمل `.use("*", RequireAuth(), RequireRole(["SuperAdmin"]))` على المستوى الأعلى (T-S-02) فلا يعتمد الأمر على كل route.

## Migration Path

عند الحاجة لصفحات SSR مخصّصة أو متطلب امتثال: ADR جديد لخيار الكوكي؛ لا شيء في هذا القرار يعوقه لأن دالة الخروج وموجّه اللغة والـ proxy موحَّدون بالفعل.
