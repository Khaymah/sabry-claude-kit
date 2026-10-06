# ADR-0001: بناء عقل الموديل "شهد" من الصفر بملكية كاملة — لا fine-tune على موديل مفتوح

- **Status:** Accepted
- **Date:** 2026-07-13
- **Deciders:** Sabry
- **Project:** Shahd
- **Tags:** identity, strategy, ownership, ml

## Context

Sabry يريد موديل لغوي مخصّص للكود/السوفتوير مملوك له بالكامل وقابل للتطوير ذاتياً. المراجعة العميقة (REVIEW.md) قدّمت المفاضلة الصريحة: **Track A** (بناء العقل من الصفر — ملكية وفهم، لكن 1-2 engineer-years لموديل ضيّق غير تنافسي) مقابل **Track B** (fine-tune موديل كود مفتوح — أسابيع لموديل مفيد، لكن الـ brain ليس ملكك وفيه مخاطر تراخيص).
القيد الجوهري: Sabry يريد تجنّب حوائط التراخيص وامتلاك الـ brain نفسه. **توضيح مهم:** "الملكية" عن الـ **brain/الموديل** — المكتبات المساعدة (Zod/tsx/vitest) مقبولة.

## Decision

نبني عقل شهد (tensor engine + autograd + transformer + training loop + optimizer + tokenizer-apply) **من الصفر بالكامل**، بلا fine-tune أو wrapper على أوزان موديل مفتوح. الهدف = مشروع ناجح مملوك قابل للتطوير، **مش منافسة** أي موديل.

## Considered Options

### Option 1: Track B — fine-tune موديل كود مفتوح (Qwen2.5-Coder/StarCoder2)
- **Pros:** أسابيع لموديل مفيد؛ جودة إنتاجية.
- **Cons:** الـ brain ليس ملكك؛ مخاطر تراخيص؛ يخالف هدف Sabry الجوهري.

### Option 2: مسارين متوازيين (A تعليمي + B منتج)
- **Pros:** يجمع التعلّم والمنتج.
- **Cons:** Sabry رفض الاعتماد على open source model صراحةً.

### Option 3: Track A — من الصفر بملكية كاملة ← المختار
- **Pros:** ملكية وفهم كاملان؛ IP مملوك؛ بلا حوائط تراخيص؛ قابل للتطوير ذاتياً في اتجاه الكود.
- **Cons:** بطيء (1-2 engineer-years)؛ غير تنافسي؛ يتطلب بناء كل شيء.

## Rationale

هدف Sabry ليس منافسة الـ frontier بل امتلاك عقل مفهوم قابل للتطوير — وهذا ما يحققه Track A حصراً. رافعة المالك المنفرد الواقعية = **جودة تنسيق البيانات (دليل phi-1: corpus صغير مُنسَّق يتفوّق على أكبر منه غير مُنسَّق)**، لا الـ compute.

## Consequences

### Positive
- ✅ ملكية كاملة للـ brain + IP.
- ✅ لا مخاطر تراخيص موديل.
- ✅ فهم عميق يمكّن التطوير الذاتي.

### Negative (مقبولة)
- ⚠️ بطء الوصول لموديل مفيد — نخفّفه بتركيز على جودة البيانات وتخصّص الكود.
- ⚠️ سقف قدرة محدود بالحجم — مقبول (الهدف ليس المنافسة).

### Risks
- 🚨 teacher-distilled reasoning traces في Phase 4 توتّر مع "من الصفر" — قرار صريح مؤجَّل لـ Phase 4.

## Validation Plan
- **Metric:** الوصول لموديل يكمل/يفهم كوداً بجودة معقولة للـ budget + مملوك 100%.
- **Review date:** بعد Phase 3 (base pretraining).

## References
- [SPEC.md](../../../../d:/Work/1-Nodejs/Nano%20future%20gpt/Plan/SPEC.md) · [REVIEW.md] · [CAPABILITIES.md]
- Related: ADR-0002, ADR-0003
