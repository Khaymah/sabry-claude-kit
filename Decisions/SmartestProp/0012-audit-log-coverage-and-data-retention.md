# ADR-0012: Audit Log Coverage and Data Retention — Every Admin Mutation + SuperAdmin Reads; AiLogs Kept One Year Redacted

- **Status:** Accepted
- **Date:** 2026-09-04
- **Deciders:** Sabry
- **Project:** SmartestProp
- **Tags:** security, audit, privacy, gdpr, logging
- **Related findings:** SEV-S-061 · SEV-S-062 · SEV-S-063 · SEV-S-080 · SEV-S-036 · SEV-S-102 · SEV-S-104 (Plans/Audit-2026-09-03)

## Context

- قراءات SuperAdmin لمحادثات العملاء وبيانات workspace غير مدقَّقة؛ mutations rate-limits وsystem-settings غير مدقَّقة؛ سجل التدقيق بلا IP/User-Agent؛ حدث مفاتيح الـ API يبثّ حقلاً باسم لا يطابق ما يقرأه المستمع فلا يُسجَّل شيء.
- `AiLogs` تحفظ نص المحادثات كاملاً (أسماء، هواتف، بريد) بلا تنقيح ولا انتهاء.
- ملفات السجل اليومية (`Errors.jsonl`/`Warns.jsonl`) لا تُدوَّر؛ `FilterVocabulary.Archive` يكتب ملف تصحيح لكل نداء بلا سقف.

قرار Sabry: الاحتفاظ بـ AiLogs **سنة** (لا 90 يوماً) لخدمة تحليل الجودة والتدريب، بشرط التنقيح.

## Decision

1. **التغطية:** كل mutation إداري (Admin · SuperAdmin) بلا استثناء، بما فيها rate-limits وsystem-settings وroll لمفاتيح الـ API والاستردادات؛ وكل **قراءة** SuperAdmin لبيانات مستأجر (محادثات، workspace، graph) بنوع `Read`.
2. **الحقول:** `ActorId · ActorRole · Action · TargetType · TargetId · ClientId · Ip (من ADR-0001) · UserAgent · RequestId · Before/After (للـ mutations، منقّحة)`.
3. **الأحداث:** نوع حمولة مشترك بين الباثّ والمستمع (لا سلاسل حرة)؛ اختبار يؤكد صف تدقيق لكل حدث مُسجَّل.
4. **AiLogs:** تنقيح PII قبل التخزين (هاتف، بريد، أرقام بطاقات، عناوين) إلى رموز ثابتة؛ احتفاظ **365 يوماً** ثم حذف بمهمة مجدولة تُبلغ `(محذوف / الكل)`؛ ذكر المدة في سياسة الخصوصية وشروط الخدمة؛ حذف فوري عند طلب العميل (حق المحو).
5. **السجلات:** pino `redact` للحقول الحساسة؛ logrotate يومي × 14؛ ملفات تصحيح `FilterVocabulary.Archive` خلف علم معطّل افتراضياً مع سقف وتنقيح.
6. **سجل التدقيق نفسه:** احتفاظ سنتين، لا يُحذف بواسطة الأدمن (append-only).

## Considered Options

### Option 1: تدقيق شامل + AiLogs 90 يوماً (توصيتي الأصلية)
- **Pros:** أقل تخزين والتزام.
- **Cons:** يفقد بيانات تحليل الجودة طويلة المدى.

### Option 2: تدقيق شامل + AiLogs سنة منقّحة ← المختار (قرار Sabry)
- **Pros:** يخدم تحسين الوكلاء والتدريب؛ التنقيح يحدّ من أثر التسريب.
- **Cons:** تخزين أكبر (يُقاس شهرياً)، والتزام أطول يجب ذكره للعملاء.

### Option 3: تدقيق فقط والاحتفاظ لاحقاً
- مرفوض: يبقي PII بلا انتهاء.

## Rationale

المحاور الحاكمة: **Security/Privacy** (تنقيح + انتهاء + حق المحو)، **Observability** (تدقيق يمكن الاعتماد عليه في تحقيق)، **Cost** (تخزين سنة مقبول مقابل قيمة التحليل؛ يُقاس). Performance يُسقَط.

## Consequences

### Positive
- ✅ أي إجراء إداري أو اطّلاع على بيانات مستأجر له أثر بمن/متى/من أين.
- ✅ PII لا تُخزَّن خاماً في AiLogs.
- ✅ تدوير السجلات يمنع امتلاء القرص.

### Negative (Trade-offs المقبولة)
- ⚠️ تخزين AiLogs لسنة (يُراقَب؛ إن تجاوز حدّاً يُضاف أرشيف بارد).
- ⚠️ التنقيح قد يمسّ بعض سياق التحليل (أسماء).

### Risks
- 🚨 تنقيح ناقص (أنماط غير مغطاة) — Mitigation: اختبارات على عيّنات حقيقية منقّحة + مراجعة ربع سنوية للأنماط.

## Migration Path

T-S-21 وT-S-22؛ تحديث سياسة الخصوصية بمدة السنة قبل الإصدار الأول.
