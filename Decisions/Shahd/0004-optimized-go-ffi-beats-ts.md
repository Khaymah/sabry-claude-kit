# ADR-0004: الـ Go FFI kernel المحسّن يتفوّق على TS (حسم spike الـ Phase-2)

- **Status:** Accepted
- **Date:** 2026-07-13
- **Deciders:** Sabry
- **Project:** Shahd
- **Tags:** compute, performance, go, ffi

## Context

ADR-0002 أجّل آلية الـ Go interop لـ **spike**. نتيجة الـ spike الأولى (Phase 2): مسار bun:ffi يعمل ومطابق عددياً، لكن **port ساذج للـ matmul أبطأ من Bun JIT (~0.67x)** — فبقي `TsBackend` الافتراضي. السؤال المفتوح: هل تدفع kernels محسّنة؟

## Decision

نعم. الـ kernel المحسّن (`GoKernels/ffi/matmul.go`) يستخدم رافعتين: **(1) transpose لـ B مرة واحدة** فيمشي الـ inner dot على المصفوفتين contiguously (cache locality — JS matmul يمشي على B عمودياً ويأكل cache misses)، **(2) توزيع صفوف M على goroutines** (توازي multi-core حقيقي مقابل JS أحادي الخيط). الـ k-loop يبقى تصاعدياً بـ mul-then-add بسيط → **النتيجة bit-identical لـ TsBackend** (ComputeSpike parity = 0.0e+0).

**القياس:** ~2.0x @128 · ~6.7x @256 · ~7.8x @512.

المسار يبقى **opt-in accelerator** لا الافتراضي: يحتاج DLL مبنية مسبقاً (gcc عبر PowerShell — Git Bash يكسر الـ toolchain). `TsBackend` يبقى الـ zero-dependency fallback الذي يقدر الـ forward path يرجع له دائماً.

## Considered Options

### Option 1: البقاء على TsBackend فقط
- **Pros:** بلا اعتماد على toolchain؛ محمول.
- **Cons:** يترك 2-8x أداء على الطاولة عند توفر gcc.

### Option 2: kernel محسّن opt-in ← المختار
- **Pros:** 2-8x مؤكد؛ bit-exact؛ مملوك 100%؛ TsBackend يبقى fallback.
- **Cons:** يحتاج DLL مبنية (gcc/PowerShell)؛ لم يُوصَل بعد في الـ hot forward path.

### Option 3: SIMD/blocking لـ K كبير
- محجوز: مكسب إضافي محتمل لكن transpose+goroutines يعطي معظم الفائدة الآن. يؤجَّل.

## Consequences

- الملكية محفوظة، بلا Python/CUDA. الحوسبة الثقيلة صار لها مسار سريع مملوك ومطابق عددياً.
- **التالي:** wiring الـ ComputeBackend في الـ forward path الساخن، وربما SIMD لـ K الكبيرة.
