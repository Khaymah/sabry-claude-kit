# ADR-0001: Client IP Resolution — X-Real-IP from Nginx Only, One Shared Helper

- **Status:** Accepted
- **Date:** 2026-09-04
- **Deciders:** Sabry
- **Project:** SmartestProp
- **Tags:** security, rate-limit, logging, infra
- **Related findings:** SEV-S-021 · SEV-S-068 (Plans/Audit-2026-09-03)

## Context

حدود المعدّل (`RateLimit.Core.ts`) تستخدم **أول** token من `X-Forwarded-For` كمفتاح IP، وهو الجزء الذي يكتبه العميل نفسه، فأي مهاجم يتجاوز كل الحدود بـ header واحد. `Logger.Middleware.ts` يعيد تنفيذ حلٍّ ثانٍ مختلف يتجاهل `TRUST_PROXY`. النتيجة: مفتاحان مختلفان للهوية نفسها، وكلاهما قابل للتزوير.

القيود:
- النشر الفعلي: VPS + Nginx + PM2 (بلا Docker، بلا CDN حالياً) ⇒ Nginx هو الـ hop الوحيد أمام التطبيق.
- درس Est8Core الموروث: «rate-limit بمفتاح IP من آخر hop لا أول token».
- الحلّ يجب أن يخدم ثلاثة مستهلكين بنفس القيمة: rate-limit · logger · audit (ADR لاحق للتدقيق).

## Decision

**helper واحد** `ResolveClientIp(c)` في `Src/Common/Http/ClientIp.ts` هو المصدر الوحيد لعنوان العميل:

1. إذا `TRUST_PROXY=false` ⇒ عنوان الـ socket فقط، وتُتجاهل كل headers.
2. إذا `TRUST_PROXY=true` ⇒ `X-Real-IP` الذي يكتبه Nginx؛ وإن غاب ⇒ **آخر** token من `X-Forwarded-For`؛ وإن غاب ⇒ socket.
3. لا يُقبل أول token من `X-Forwarded-For` في أي حال.
4. Nginx: `proxy_set_header X-Real-IP $remote_addr;` ويُسقط أي `X-Forwarded-For` وارد من العميل (`proxy_set_header X-Forwarded-For $remote_addr;`).
5. `RateLimit.Core.ts` و`Logger.Middleware.ts` وأي قارئ آخر لـ `x-forwarded-for` يُستبدل بالـ helper (جرد بـ Grep، لا استثناء).

## Considered Options

### Option 1: X-Real-IP من Nginx + helper واحد ← المختار
- **Pros:** أبسط نموذج ثقة، يطابق البنية الحالية حرفياً، سطر ضبط واحد في Nginx، اختبار وحدة بسيط.
- **Cons:** يفترض hop واحداً؛ إضافة CDN لاحقاً تتطلّب تحديث القاعدة (محفوظ كمسار هجرة أدناه).

### Option 2: آخر hop من X-Forwarded-For مع `TRUST_PROXY_IPS`
- **Pros:** يصمد لسلسلة proxies (CDN + Nginx).
- **Cons:** أعقد، وخطأ في قائمة الـ IPs الموثوقة يفتح التزوير من جديد؛ لا حاجة له اليوم.

### Option 3: الإبقاء على الوضع الحالي
- مرفوض: تجاوز كامل لحدود المعدّل بـ header واحد (SEV-S-021).

## Rationale

المحوران الحاكمان: **Security** (لا مفتاح قابل للتزوير) و**Reliability** (سجلات وتدقيق صادقان). Scalability لا يتغيّر بعدد نسخ التطبيق لأن القيمة تُشتقّ من Nginx لا من العملية. Cost صفر. الخيار الأبسط الذي يغلق الثغرة بالكامل في البنية الفعلية هو الأصحّ؛ المرونة لسلسلة proxies تُشترى عند الحاجة لا قبلها.

## Consequences

### Positive
- ✅ مفتاح IP واحد لا يمكن للعميل التأثير فيه.
- ✅ موطن واحد للمنطق (يلغي التكرار في Logger.Middleware).
- ✅ اختبار وحدة قاطع: `XFF: 1.1.1.1, 10.0.0.5` مع TRUST_PROXY ⇒ `10.0.0.5`؛ بدونه ⇒ socket.

### Negative (Trade-offs المقبولة)
- ⚠️ بيئة التطوير بلا Nginx يجب أن تعمل بـ `TRUST_PROXY=false` وإلا تُصبح كل الطلبات من IP واحد.
- ⚠️ إضافة CDN تتطلّب مراجعة هذا الـ ADR (Option 2).

### Risks
- 🚨 ضبط `TRUST_PROXY=true` على خادم مكشوف بلا Nginx يعيد الثغرة — Mitigation: فحص إقلاع يحذّر إذا `TRUST_PROXY=true` و`NODE_ENV=production` بينما لا يصل `X-Real-IP` في أول طلبات.

## Migration Path

عند إضافة CDN/Cloudflare: فعّل `TRUST_PROXY_IPS` (قائمة الـ CIDRs الموثوقة) واجعل الـ helper يمشي `X-Forwarded-For` من اليمين متجاوزاً الـ IPs الموثوقة حتى أول IP غير موثوق — دون تغيير في واجهة الـ helper أو مستهلكيه.
