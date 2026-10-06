# ADR-0011: OAuth Scopes in JWT Claims (TTL ≤ 1h), API-Key Scope Allow-List with Role Check at Creation

- **Status:** Accepted
- **Date:** 2026-09-04
- **Deciders:** Sabry
- **Project:** SmartestProp
- **Tags:** security, auth, oauth, api-keys
- **Related findings:** SEV-S-006 · SEV-C-021 (+ امتداد ApiKeys.Schema) (Plans/Audit-2026-09-03)

## Context

- عملاء OAuth يحملون `Scopes` في قاعدة البيانات، لكن التوكن الصادر لا يضمّنها و`RequireScopes` لا يقرأها؛ الحارس no-op صامت لكل توكنات OAuth (ضابط بُني ولم يُوصَل).
- مفاتيح الـ API تقبل `Scopes` من العميل بلا allow-list ولا فحص دور؛ واجهة العميل «تخفي» الـ scopes الإدارية فقط.

القيود: التوكنات JWT بلا حالة؛ إبطال التوكنات عبر Redis (ADR-0002)؛ مفاتيح الـ API طويلة العمر وتُتحقّق من DB على كل طلب أصلاً.

## Decision

1. **OAuth:** عند إصدار التوكن تُضمَّن `Scopes` (مصفوفة) و`ClientId` في الـ claims؛ `RequireScopes` يقرأ الـ claims حصراً؛ TTL ≤ ساعة؛ تغيير scopes عميل OAuth يسري عند التوكن التالي (وللإبطال الفوري: إبطال بالـ `jti` عبر ADR-0002).
2. **مفاتيح الـ API:** `Scopes` تُتحقّق ضد allow-list ثابتة (enum) في schema الإنشاء/التحديث؛ الـ scopes الإدارية تتطلّب دور `Admin`/`SuperAdmin` على الخادم (400 للعميل)؛ الفحص عند الاستخدام يبقى من DB (لا تغيير).
3. **الحارس نفسه للاثنين:** `RequireScopes` يعمل على `AuthContext.Scopes` أياً كان المصدر (claims للـ OAuth، DB لمفتاح API)، واختبار Edge لكل route يعلن `RequireScopes` يؤكد 403 بلا الـ scope.

## Considered Options

### Option 1: claims + TTL قصير + فحص الدور عند الإنشاء ← المختار
- **Pros:** بلا استعلام إضافي لكل طلب OAuth؛ نموذج قياسي؛ يغلق SEV-S-006 وSEV-C-021.
- **Cons:** تغيير الـ scopes ينتظر انتهاء التوكن (≤ ساعة) ما لم يُبطل.

### Option 2: استعلام DB للـ scopes في كل طلب
- **Pros:** فوري.
- **Cons:** استعلام على كل نداء OAuth أو كاش Redis يزيد الاعتماد عليه.

## Rationale

المحوران الحاكمان: **Security** (حارس فعّال لا شكلي) و**Performance** (لا استعلام لكل طلب). Maintainability: نفس الحارس لمصدرين. Cost صفر.

## Consequences

### Positive
- ✅ `RequireScopes` يصبح ضابطاً حقيقياً باختبار قاطع.
- ✅ لا scope إداري بيد عميل.

### Negative (Trade-offs المقبولة)
- ⚠️ نافذة ≤ ساعة لتغييرات الـ scopes بلا إبطال.

### Risks
- 🚨 نسيان إضافة scope جديد إلى الـ allow-list — Mitigation: الـ enum مصدر واحد تُشتقّ منه schema الإنشاء وواجهة العميل (الخادم مصدر الحقيقة).

## Migration Path

T-S-01 (البند 4) وT-C-03؛ التوكنات القائمة بلا claims تُعامل كبلا scopes حتى تُجدَّد.
