# ADR-0013: Single PM2 Instance (Documented), Graceful Shutdown with wait_ready, Event Broker Behind an Interface

- **Status:** Accepted
- **Date:** 2026-09-04
- **Deciders:** Sabry
- **Project:** SmartestProp
- **Tags:** availability, deploy, pm2, scalability
- **Related findings:** SEV-S-029 · SEV-S-059 (+ امتداد Runtime.Live) (Plans/Audit-2026-09-03)

## Context

- لا معالجة لـ `SIGTERM`: `pm2 reload` يقطع الطلبات الجارية وSSE فوراً؛ `wait_ready` مضبوط لكن `process.send("ready")` لا يُستدعى فيعمل PM2 بالمهلة.
- حالة داخل العملية: SSE broker للإشعارات، بثّ وضع الصيانة (`Runtime.Live`)، كاش قواعد الاعتدال — كلها تنكسر مع أكثر من عملية.
- الواقع: نسخة PM2 واحدة (fork) على VPS؛ لا حمل يبرّر cluster اليوم.

## Decision

1. **نسخة واحدة موثّقة:** `ecosystem.config` بـ `instances: 1` و`exec_mode: fork` صراحة، وذكر القاعدة في `Server/CLAUDE.md §7`: «أي انتقال إلى cluster/عدة خوادم يتطلّب ADR جديداً ينقل الحالة المذكورة أدناه إلى Redis».
2. **إغلاق آمن:** عند `SIGTERM/SIGINT`: إيقاف قبول اتصالات جديدة → إرسال حدث إغلاق لطيف لعملاء SSE → انتظار الطلبات الجارية حتى 10 ثوانٍ → إغلاق pool وRedis → خروج 0؛ `process.send?.("ready")` بعد الاستماع؛ `kill_timeout: 12000` في PM2.
3. **تجريد الحالة المشتركة:** واجهة `IEventBroker` (publish/subscribe) بتنفيذ محلي الآن؛ SSE broker وبثّ الصيانة وإبطال كاش الاعتدال تمرّ عبرها؛ تنفيذ Redis pub/sub يُضاف عند التوسّع دون لمس المستهلكين.
4. **سقوف ADR-0002 المحلية** تبقى لكل عملية، وهو دقيق ما دامت العملية واحدة.

## Considered Options

### Option 1: نسخة واحدة موثّقة + إغلاق آمن + تجريد ← المختار
- **Pros:** يغلق فقدان الطلبات عند النشر بأقل تغيير؛ يمنع تكرار الحالة داخل الذاكرة بلا وعي؛ يترك التوسّع تبديل تنفيذ لا إعادة كتابة.
- **Cons:** لا توسّع أفقي حتى ADR لاحق.

### Option 2: cluster + Redis pub/sub الآن
- **Pros:** جاهزية توسّع فورية.
- **Cons:** يوسّع نطاق العمل (كل حالة محلية بما فيها سقوف ADR-0002) بلا حمل يبرّره.

## Rationale

المحاور الحاكمة: **Availability** (نشر بلا قطع) و**Scalability** (مؤجَّل بوعي وبمسار واضح). Cost صفر. Performance يُسقَط.

## Consequences

### Positive
- ✅ `pm2 reload` أثناء SSE مفتوح ⇒ لا 502 للطلبات الجديدة ولا قطع فوري.
- ✅ الحالة المشتركة معروفة بالاسم وخلف واجهة واحدة.

### Negative (Trade-offs المقبولة)
- ⚠️ سقف عمودي واحد (نسخة واحدة) حتى ADR التوسّع.

### Risks
- 🚨 رفع `instances` في PM2 بلا ADR يكسر SSE والاعتدال بصمت — Mitigation: فحص إقلاع يحذّر إن كان `NODE_APP_INSTANCE > 0` أو `pm2` في وضع cluster بينما الـ broker محلي.

## Migration Path

T-S-18؛ عند التوسّع: ADR جديد + تنفيذ `RedisEventBroker` + نقل السقوف المحلية إلى Redis.
