# ADR-0005: AI Provider BaseUrl — Admin-Only with Network Validation, and Per-Tenant Circuit Breaker Keys

- **Status:** Accepted
- **Date:** 2026-09-04
- **Deciders:** Sabry
- **Project:** SmartestProp
- **Tags:** security, ssrf, ai-providers, resilience
- **Related findings:** SEV-S-016 · SEV-S-017 · SEV-S-048 (Plans/Audit-2026-09-03)

## Context

- schema اختبار الاعتماديات (`AiModels.Schema.ts`) يقبل `BaseUrl` من أي عميل مصادَق، والخادم ينادي ذلك العنوان ويعيد جسم الخطأ للعميل ⇒ SSRF كامل (فحص الشبكة الداخلية، metadata endpoints، Redis/Postgres على localhost).
- الاختبار نفسه يمرّ بقاطع الدائرة المشترك للمزوّد؛ عميل واحد بمفتاح خاطئ يُسقط المزوّد لكل المستأجرين.
- `GeminiAdapter` يقبل `BaseUrl` ويتجاهله بصمت (accept-and-ignore).

القيود: العملاء يجلبون اعتمادياتهم (BYO keys) للمزوّدين المعروفين؛ لا طلب حالي من عميل لـ proxy خاص.

## Decision

1. **`BaseUrl` يُحذف من schema العميل نهائياً** (لا يُقبل ولا يُتجاهل؛ إرساله = 400).
2. **الأدمن فقط** يضبط `BaseUrl` على مستوى المزوّد، بتحقّق **عند الحفظ وعند كل طلب**: `https` فقط · حلّ DNS ورفض كل عنوان ناتج ضمن النطاقات الخاصة/loopback/link-local/`169.254.169.254`/ULA · لا اتباع redirects · مهلة 10 ثوانٍ · حدّ حجم للاستجابة.
3. **مفتاح قاطع الدائرة** = `${ProviderId}:${CredentialSource}:${ClientId ?? "system"}`؛ اختبار اعتماد عميل لا يمسّ مفتاح الإنتاج، وHALF_OPEN يسمح بمسبار واحد.
4. **أجسام أخطاء المزوّد لا تُعاد للعميل**؛ تُسجَّل مع `RequestId` ويُعاد كود i18n (`Providers.TestFailed` + فئة السبب: auth/network/quota).
5. Gemini: إمّا يُمرَّر `BaseUrl` للـ SDK فعلاً أو يُرفض بوضوح عند الحفظ — لا تجاهل صامت.

## Considered Options

### Option 1: BaseUrl للأدمن فقط + تحقّق شبكي + breaker منفصل ← المختار
- **Pros:** يغلق SSRF من جذره (لا سطح للعميل)، ويعزل أعطال المستأجرين عن بعضهم.
- **Cons:** لا proxies خاصة للعملاء؛ الأدمن يتحمّل ضبط أي endpoint غير قياسي.

### Option 2: allowlist مضيفي المزوّدين + استثناءات يقرّها الأدمن
- **Pros:** مرونة للعملاء ضمن قائمة معروفة.
- **Cons:** صيانة القائمة + مسار موافقة؛ لا حاجة اليوم. محفوظ كمسار هجرة.

### Option 3: السماح للعملاء مع تحقّق شبكي فقط
- مرفوض: يحجب الشبكة الداخلية لكنه يبقي الخادم يرسل اعتماديات ومحتوى إلى أي مضيف خارجي يختاره العميل.

## Rationale

المحوران الحاكمان: **Security** (SSRF بحساب عادي) و**Availability** (breaker مشترك = انقطاع لكل المستأجرين). Performance وCost يُسقَطان: التحقّق عند الحفظ يكلّف استعلام DNS واحداً. القيد على مرونة العملاء مقبول لغياب الطلب الفعلي.

## Consequences

### Positive
- ✅ لا مسار من مدخلات عميل إلى نداء شبكي بعنوان حرّ.
- ✅ فشل عميل واحد لا يعطّل المزوّد للآخرين.
- ✅ رسائل خطأ متسقة ومترجمة بدل أجسام خام.

### Negative (Trade-offs المقبولة)
- ⚠️ عميل يحتاج endpoint متوافقاً مع OpenAI على مضيف خاص يطلبه من الأدمن.
- ⚠️ تعدّد مفاتيح الـ breaker يزيد عدد الحالات المتتبَّعة في Redis (مقبول: عدد المستأجرين × المزوّدين).

### Risks
- 🚨 التحقّق عند الحفظ فقط يُخترق بـ DNS rebinding — Mitigation: التحقّق عند الطلب أيضاً مع تثبيت العنوان المحلول (pinning) في الاتصال.

## Migration Path

عند طلب فعلي من عملاء لمضيفين خاصين: تفعيل Option 2 كطبقة فوق هذا القرار (allowlist + موافقة أدمن) دون تغيير التحقّق الشبكي أو مفتاح الـ breaker.
