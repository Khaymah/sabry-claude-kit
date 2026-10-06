# ADR-0005: ترجمة رسائل السيرفر (server-side) + ترجمة محتوى الإعدادات ({ar,en})

- **Status:** Accepted
- **Date:** 2026-07-12
- **Deciders:** Sabry
- **Project:** SweetsStore
- **Tags:** i18n, api, dx, settings
- **Refines:** ADR-0003 (i18n عربي-أساسي جاهز للترجمة)

## Context

بعد بناء الـ Backend، لاحظ Sabry فجوتين في الـ i18n:

1. **رسائل الاستجابة كانت مفاتيح خام:** `Message` (و `Error.Message`) كانت تُرجَع كمفتاح (`settings.all`, `payment_accounts.list`, `auth.missing_token`) — بلا ترجمة سيرفر-سايد. الـ Locale كان يُكتشف في `RequestContext` لكنه مُستخدَم في الـ Orders فقط.
2. **الإعدادات (Settings) عربية فقط:** جدول `Settings` هو `Key + jsonb Value` بلا بنية ترجمة، وبيانات الـ seed كانت نصوصاً عربية مفردة (`storeInfo`, `banners`, `aboutContent`) — بينما كيانات الـ domain (منتجات/تصنيفات/نقاط استلام/مناطق) مترجمة عبر translation tables.

ADR-0003 أرسى «عربي-أساسي جاهز للترجمة» عبر translation tables لكنه لم يحسم **كيف تُترجم الرسائل** ولا **شكل ترجمة محتوى الإعدادات الحر**.

## Decision

1. **رسائل السيرفر تُترجَم في السيرفر** حسب الـ Locale المُكتشف (`?lang=` أو `accept-language`, fallback `ar`):
   - قاموس مركزي `Src/Core/I18n/Messages.ts` (كل المفاتيح ar/en) + `TranslateMessage(key, locale)`.
   - يُربَط في `Response.Helper` (Success/Created/Ok) و `Error.Middleware`، وأي استجابة inline (Files 404, App.notFound).
   - **`Error.Code` يبقى سلسلة آلة ثابتة** (منطق العميل)؛ **`Message` يُترجَم** (عرض للمستخدم).
   - مفتاح مفقود → fallback للمفتاح نفسه + `console.warn` في dev (لا يكسر أبداً).
2. **محتوى الإعدادات النصّي القابل للترجمة = كائن `{ar,en}` داخل الـ JSON** (الفرونت يختار). الحقول المحايدة (هاتف/إيميل/روابط/عملة) تبقى نصاً عادياً. لا جدول ترجمة (الإعدادات singletons — over-engineering).
3. **تفاصيل أخطاء Zod الحقلية تُترجَم** عبر `TranslateZodIssue(issue, locale)` (حسب `issue.code`, لا النص الإنجليزي الجاهز). كل تفصيلة تحمل `{ path, code, message }` — `code` ثابت للمنطق و`message` مترجم. رسائل الـ `custom` refine تبقى كما كتبها المطوّر (نادرة، قيود لا نصّ مستخدم).
4. **توحيد تنسيق الـ validation:** `Parse()` يرمي **ZodError الخام**، والـ Error middleware هو المنسّق/المترجم الوحيد (كان تنسيقاً مزدوجاً قبلاً).

## Considered Options

### ترجمة الرسائل
- **السيرفر يترجم ← المختار:** `Message` يرجع نصاً مترجماً حسب Accept-Language. يفيد الـ consumers المباشرين للـ API + تجربة أوضح. الثمن: صيانة قاموس (مخفّف بـ fallback + dev-warn).
- **مفاتيح + الفرونت يترجم (client-side):** الـ API locale-agnostic؛ رُفض لصالح خيار Sabry الصريح بترجمة السيرفر.
- **Hybrid (مفتاح + MessageText):** أقوى لكن أكثر شغلاً — رُفض.

### ترجمة الإعدادات
- **`{ar,en}` داخل الـ JSON ← المختار:** أخف ومتّسق وظيفياً بلا جدول.
- **جدول SettingTranslations:** متّسق شكلياً مع باقي الكيانات لكنه over-engineering لمحتوى config فردي.
- **عربي فقط:** يخالف مبدأ «ترجمة لكل حاجة».

## Consequences

### Positive
- ✅ الرسائل (نجاح + خطأ + 404 inline) مترجمة تلقائياً حسب لغة الطلب.
- ✅ `Error.Code` ثابت للمنطق، `Message` للعرض — فصل نظيف.
- ✅ محتوى الإعدادات ثنائي اللغة بلا migration ولا جدول جديد.
- ✅ seed الإعدادات idempotent (upsert) ويُحدَّث بإعادة التشغيل دون مسح الكتالوج.

### Negative (Trade-offs مقبولة)
- ⚠️ **ثلاثة أشكال i18n في API واحد:** domain data كمصفوفات `[{Locale,Name}]` · settings ككائنات `{ar,en}` · messages كسلسلة يختارها السيرفر. مقبول لكن **يجب توثيقه كعُرف** — والفرونت **يعرض `Message` مباشرة** ولا يعيد ترجمته.
- ⚠️ قاموس الرسائل قد ينجرف (مفتاح جديد بلا إدخال) → مخفّف بـ fallback-للمفتاح + `console.warn` في dev.
- ⚠️ تفاصيل Zod تبقى إنجليزية (حدّ موثّق).

### Risks
- 🚨 كاش الكتالوج العام (`Cached 60s`) يخفي تحديثات الإعدادات عند التحقق → **Mitigation:** التحقق عبر مسار الأدمن غير المخزّن `GET /api/v1/settings` أو DB مباشرة. (ملاحظة: `Message` يُترجَم لكل طلب ولا يُخزَّن — الكاش يخص الـ Data فقط.)

## Validation Plan

- **Metric 1:** استجابة بـ `accept-language: en` تُرجع `Message` إنجليزياً و `ar` عربياً، و`Error.Code` ثابت. (متحقَّق: catalog + errors + payment_accounts).
- **Metric 2:** `GET /api/v1/settings` يُظهر `storeInfo.name`/`banners[].title`/`aboutContent.body` كـ `{ar,en}`. (متحقَّق عبر المسار غير المخزّن).
- **Review date:** 2026-10-12 (مع مراجعة الـ i18n في ADR-0003).

## References

- ADR-0003 (i18n عربي-أساسي)
- `Src/Core/I18n/Messages.ts`, `Src/Core/Response/Response.Helper.ts`, `Src/Core/Middleware/Error.Middleware.ts`, `Src/Database/SeedDemo.ts`
