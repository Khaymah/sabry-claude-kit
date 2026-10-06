# ADR-0014: Security Headers Ownership — Nginx for Static Headers, Next for CSP, Report-Only First

- **Status:** Accepted
- **Date:** 2026-09-04
- **Deciders:** Sabry
- **Project:** SmartestProp
- **Tags:** security, headers, csp, nginx, nextjs
- **Related findings:** SEV-C-015 · SEV-C-016 · SEV-S-084 (nosniff) (Plans/Audit-2026-09-03)

## Context

لا يوجد أي رأس أمان في أي طبقة: لا CSP، لا HSTS، لا `X-Frame-Options`/`frame-ancestors`، لا `Referrer-Policy`، لا `X-Content-Type-Options`. إضافة إلى ذلك `Client/nginx.no-cache.conf` يحوي كتلتَي `location /` في نفس الـ server فيفشل `nginx -t`.

القيود المميِّزة لهذا المشروع:
- الـ **widget مضمَّن عمداً** في مواقع العملاء ⇒ لا يجوز `X-Frame-Options: DENY` عليه، بل `frame-ancestors` لنطاقات العميل المسجّلة.
- الواجهة تستخدم Google Maps وخطوطاً خارجية وسكربتات Next المضمَّنة ⇒ CSP صارم بلا قياس مسبق يكسر صفحات.
- Nginx يخدم ملفات ساكنة مباشرة، والـ API على أصل مختلف.

## Decision

1. **Nginx يملك الرؤوس الثابتة** لكل الاستجابات (بما فيها الملفات الساكنة والـ API): `Strict-Transport-Security` (بعد التأكد من TLS كامل على كل النطاقات الفرعية) · `X-Content-Type-Options: nosniff` · `Referrer-Policy: strict-origin-when-cross-origin` · `X-Frame-Options: DENY` **لنطاق لوحة التحكم فقط**.
2. **Next يملك CSP** عبر `headers()` مع `nonce` للسكربتات المضمَّنة: يبدأ `Content-Security-Policy-Report-Only` مع endpoint تقارير لمدة **أسبوع**، تُراجَع التقارير، ثم يُحوَّل إلى `Content-Security-Policy` بعد صفر انتهاكات حقيقية.
3. **الـ widget** يحصل على سياسة خاصة: بلا `X-Frame-Options`، و`frame-ancestors` تُبنى ديناميكياً من نطاقات العميل المسجّلة في إعدادات الـ embed (نفس مصدر قائمة CORS في T-S-02).
4. **إصلاح `nginx.no-cache.conf`:** دمج كتلتَي `location /` في واحدة، و`nginx -t` جزء من إجراء النشر.
5. **لا تكرار:** أي رأس يملكه Nginx لا يُضاف في Next والعكس؛ الجدول موثَّق في `Client/CLAUDE.md` وإجراء النشر.

## Considered Options

### Option 1: Nginx للثابت + Next لـ CSP بـ report-only ← المختار
- **Pros:** كل رأس في الطبقة الأقدر عليه (HSTS عند TLS، CSP حيث الـ nonce)؛ الطرح المرحلي يمنع كسر الإنتاج.
- **Cons:** موطنان للرؤوس (مخفَّف بجدول ملكية موثّق)؛ أسبوع قبل الحماية الفعلية للـ CSP.

### Option 2: كل الرؤوس من Next
- **Pros:** موطن واحد في الكود ومحمول لأي استضافة.
- **Cons:** لا يغطي الملفات الساكنة التي يخدمها Nginx ولا الـ API؛ HSTS منطقياً في طبقة TLS.

### Option 3: فرض CSP مباشرة
- مرفوض: خطر كسر Maps والخطوط والـ widget في الإنتاج بلا قياس.

## Rationale

المحوران الحاكمان: **Security** (سطح XSS/clickjacking مكشوف بالكامل اليوم) و**Availability** (CSP خاطئ يكسر الواجهة، لذلك report-only أولاً). Performance وCost يُسقَطان.

## Consequences

### Positive
- ✅ `curl -I` يُظهر مجموعة رؤوس كاملة على الوثيقة والملفات والـ API.
- ✅ الـ widget يبقى قابلاً للتضمين عند العملاء المسجّلين فقط.
- ✅ `nginx -t` ينجح ويصبح جزءاً من النشر.

### Negative (Trade-offs المقبولة)
- ⚠️ أسبوع بلا فرض فعلي للـ CSP.
- ⚠️ جدول ملكية يجب احترامه لتجنّب رؤوس مكرّرة متعارضة.

### Risks
- 🚨 HSTS مع نطاق فرعي بلا TLS يقطع الوصول إليه — Mitigation: بدء `max-age` صغير بلا `includeSubDomains`، ثم التوسيع بعد التأكد.
- 🚨 `frame-ancestors` ديناميكية تُبنى من إدخال العميل ⇒ حقن رأس — Mitigation: تحقّق صارم من صيغة النطاق عند الحفظ (نفس تحقّق CORS).

## Migration Path

T-C-09؛ بعد أسبوع التقارير يُحوَّل الرأس إلى الفرض ويُوثَّق التاريخ هنا.
