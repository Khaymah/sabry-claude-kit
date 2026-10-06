# ADR-0009: Test Gates — Behavior over Text Presence, Mandatory Happy Path, Vitest + Playwright for the Client

- **Status:** Accepted
- **Date:** 2026-09-04
- **Deciders:** Sabry
- **Project:** SmartestProp
- **Tags:** testing, ci, quality-gates
- **Related findings:** SEV-S-030 · SEV-S-031 · SEV-S-092 · SEV-S-095 · SEV-S-069 · SEV-S-070 · SEV-S-107 · SEV-C-035 · SEV-C-036 · SEV-C-057 (Plans/Audit-2026-09-03)

## Context

- 15 من 27 موديولاً في الخادم (بينها Auth · Billing · ApiKeys · RateLimits · Admin) «اختبارات وحدتها» ملفات مولَّدة تقرأ المصدر كنص وتتحقق من وجود أسماء دوال؛ لا سلوك يُقاس.
- بوابة E2E/Edge الإلزامية تشترط سيناريوهات 4xx فقط؛ المسار السعيد لا يُنفَّذ عبر HTTP لـ 24 من 26 موديولاً، لذلك مرّ خطأ schema `/recommendations` (كائن مُعلَن كمصفوفة).
- حارس الطول 650 بينما القاعدة 600؛ حارس `any` يفوّت `as any` (6 مواضع في AiEngine الإنتاجي).
- `InMemoryRedis.scan()` في TestKit يقتطع النتائج فتمرّ حلقات `scan` في الاختبار وتفشل مع Redis الحقيقي.
- العميل: صفر ملفات اختبار، CI لا يشغّل `verify:push`، وفحوص `any`/`console.log` إرشادية.
- درس Est8Core: «بوابة موجودة كسكربت غير موصولة بالـ CI = غير موجودة»، و«مراجعة ≠ اختبار».

## Decision

**الخادم**
1. اختبار الوحدة = سلوك: مدخلات → مخرجات/آثار، بـ mocks من `Common/TestKit` (DB · Redis · مزوّدو AI). يُمنع أي اختبار يقرأ ملف مصدر كنص (بوابة Grep على `readFileSync` داخل `Test/Unit`).
2. بوابة E2E: لكل route حالة 2xx واحدة على الأقل مع تحقّق من schema الاستجابة عبر `OpenApiResponseValidator`، إضافة إلى 4xx الحالية.
3. `MAX_FILE_LINES = 600` (اختبارات/بذور/إعدادات مستثناة كما هي)؛ `@typescript-eslint/no-explicit-any: error` يحلّ محلّ grep.
4. TestKit يطابق دلالات Redis الفعلية (`scan` بمؤشر و`COUNT`) أو يُستبدل بـ `ioredis-mock`.
5. الاختبار **module-scoped** أثناء التطوير (`bun test Src/Modules/<M>`)، والبوابات على الكل في CI فقط.

**العميل**
6. Vitest + Testing Library للـ hooks والمكوّنات الحرجة (`api.ts` · `SafeUrl` · `useRefreshableData` · نماذج المصادقة).
7. Playwright لثلاثة مسارات حرجة: دخول → محادثة → فوترة، ضد خادم اختبار ببيانات بذور.
8. CI يشغّل `verify:push` كاملاً (typecheck · lint `--max-warnings=0` · format check · tests)؛ `any`/`console.*` قواعد ESLint فاشلة لا grep إرشادي.
9. بوابة الفرونت اليدوية تبقى إلزامية قبل الإعلان عن اكتمال أي مهمة UI: تحميل حيّ في المتصفح بصفر console errors (عربي + إنجليزي).

## Considered Options

### Option 1: سلوك لا نصّ · happy-path إلزامي · Vitest + Playwright ← المختار
- **Pros:** البوابات تقيس ما تدّعيه؛ الانحدارات في المال والأمن تُلتقط قبل الدمج.
- **Cons:** أسبوعان تقريباً من العمل الأولي؛ زمن CI أطول.

### Option 2: الخادم فقط الآن، اختبارات العميل بعد الإصدار الأول
- **Pros:** يركّز على ما يحمي المال والأمن.
- **Cons:** العميل يبقى بلا شبكة أمان في الفترة الأكثر تغييراً (P1/P2 تلمس معظم الصفحات).

### Option 3: ترقيع البوابات الحالية فقط
- **Pros:** ساعات.
- **Cons:** اختبارات وجود النص تبقى «خضراء» بلا معنى؛ يكرّر خطأ Est8Core نفسه.

## Rationale

المحاور الحاكمة: **Reliability** (بوابة كاذبة أخطر من غيابها) و**Maintainability** (كل مهمة في الخطة تنتهي بتشغيل اختبار الموديول). Cost مُصرَّح به: أسبوعان، مقابل 174 تغييراً قادماً بلا شبكة أمان. Performance يُسقَط.

## Consequences

### Positive
- ✅ «تم» في أي مهمة تعني اختباراً شُغّل، لا مراجعة.
- ✅ schema/handler drift يُلتقط آلياً.
- ✅ حوارس الطول و`any` تطابق القواعد المكتوبة.

### Negative (Trade-offs المقبولة)
- ⚠️ أسبوعان أوليان + دقائق إضافية في كل CI.
- ⚠️ Playwright يحتاج بيئة خادم اختبار في CI (DB + Redis) — تُبنى مرة.

### Risks
- 🚨 استبدال 15 موديولاً دفعة واحدة يوقف التطوير — Mitigation: الترتيب Auth → Billing → ApiKeys → RateLimits → Admin أولاً (الحرجة)، والباقي مع مهام P2/P3 التي تلمسها.

## Migration Path

T-S-26 وT-S-27 (الخادم) وT-C-12 (العميل)؛ البوابات الجديدة تُضاف بوضع تحذير أسبوعاً ثم تُحوَّل إلى فشل.
