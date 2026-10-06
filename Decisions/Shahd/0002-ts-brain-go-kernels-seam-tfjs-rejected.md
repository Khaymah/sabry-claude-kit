# ADR-0002: TypeScript للعقل + Go للـ kernels خلف compute-backend seam — رفض tfjs-node-gpu

- **Status:** Accepted
- **Date:** 2026-07-13
- **Deciders:** Sabry
- **Project:** Shahd
- **Tags:** stack, architecture, performance, compute

## Context

عقل شهد يُكتب من الصفر (ADR-0001). الـ pure-TS-CPU سيصطدم بحائط سرعة بسرعة. SPEC الأصلي راهن على `tfjs-node-gpu` لتوسيع الحوسبة (Phase 2). المراجعة (REVIEW.md L2) أثبتت أن `tfjs-node-gpu` **شبه ميت**: آخر إصدار مستقر من ~21 شهر، مثبّت على CUDA 11.2 (2020)، ومكسور فعلياً على Windows + Node ≥22 (بيئة Sabry) بـ ERR_DLOPEN_FAILED. Sabry أضاف **Go** للـ stack المسموح وحظر Python إلا سكربتات ضرورة.

## Decision

الـ autograd tape + بنية العقل تبقى TypeScript **للأبد**. عند حائط الـ CPU (Phase 2)، الأجسام الرقمية للـ ops الساخنة (MatMul/SoftmaxRows/LayerNorm) تُفوَّض لـ **Go kernels** خلف **compute-backend seam** (interface فوق flat Float64Array + rank-general Shape، صفر معرفة بالـ autograd). `tfjs-node-gpu` **مرفوض**. الآلية الدقيقة للـ Go interop تُحسَم بـ **spike** في Phase 2 (bun:ffi مرشّح أول). في Phase 1 رياضيات الـ ops تعيش داخل `Ops/*.ts` — لا يُبنى الـ backend الآن.

## Considered Options

### Option 1: tfjs-node-gpu
- **Pros:** "in-language" ظاهرياً؛ native TF backend.
- **Cons:** ميت (~21 شهر)؛ CUDA 11.2؛ مكسور على Windows+Node22؛ يحتاج Python toolchain؛ يستبدل الـ autograd المملوك بـ autograd خاص به (يخالف ADR-0001).

### Option 2: WebGPU (WGSL) kernels
- **Pros:** المسار الوحيد لـ GPU حقيقي مع بقاء الملكية.
- **Cons:** مشروع systems متعدد الأشهر؛ يحتاج مهارة GPU-shaders؛ صعب التطوير الذاتي. → محجوز كخانة، ليس الآن.

### Option 3: Go kernels خلف seam ← المختار
- **Pros:** compiled + متوازي؛ بلا Python/node-gyp/CUDA؛ مملوك 100%؛ في stack Sabry؛ قابل للفهم/التطوير؛ يرفع سقف الـ CPU بقوة.
- **Cons:** GPU story أضعف (يؤجَّل)؛ يحتاج interop spike؛ حدّ TS↔Go marshalling.

## Rationale

Go يطابق كل قيود Sabry (مملوك، بلا Python، في معرفته، compiled) ويرفع سقف الـ CPU دون التخلي عن الـ autograd المملوك. الـ seam يعزل القرار فلا يلمس كود النموذج. تأجيل الآلية لـ spike يتّبع انضباط REVIEW ("قِس، لا تفترض").

## Consequences

### Positive
- ✅ العقل يبقى TS مملوك؛ السرعة من Go وقت الحاجة.
- ✅ تجنّب لغم tfjs بالكامل.
- ✅ الـ serving يبقى 100% Node/Bun (C4).

### Negative (مقبولة)
- ⚠️ لا GPU حقيقي الآن — WebGPU محجوز لو لزم.
- ⚠️ حدّ TS↔Go يحتاج marshalling — نخفّفه بـ interface فوق flat arrays.

### Risks
- 🚨 أي مسار native-build (FFI) قد يعيد لغم tfjs على Windows — نخفّفه بـ spike على جهاز Sabry الفعلي قبل الالتزام.

## Validation Plan
- **Metric:** spike Phase 2: MatMul fwd+bwd في Go، benchmark ضد TS على Windows+Node22، + بوابة تكافؤ عددي.
- **Review date:** بداية Phase 2.

## References
- [REVIEW.md §2, §4] · [ARCHITECTURE.md §6]
- Related: ADR-0001, ADR-0003
