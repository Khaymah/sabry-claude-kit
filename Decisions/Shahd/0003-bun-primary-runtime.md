# ADR-0003: Bun كـ runtime أساسي لمشروع شهد

- **Status:** Accepted
- **Date:** 2026-07-13
- **Deciders:** Sabry
- **Project:** Shahd
- **Tags:** runtime, stack

## Context

شهد يُكتب TS (ADR-0001) مع Go kernels خلف seam لاحقاً (ADR-0002). آلية الـ Go interop المستقبلية تعتمد على الـ runtime: `bun:ffi` متاح في Bun فقط، بينما Node يحتاج koffi/N-API/subprocess. القرار upstream ويقيّد ما بعده. Phase 0/1 بلا كود runtime-specific — فالتكلفة الآن صفر تقريباً، والغموض لاحقاً مكلف.

## Decision

**Bun هو الـ runtime الأساسي.** يفتح `bun:ffi` كمرشّح أول لمسار Go، test runner أصلي، `.env` تلقائي، وأداء أسرع. Node ≥22 يبقى مدعوماً حيث يسهل، لكن Bun هو المرجع.

## Considered Options

### Option 1: Node-primary
- **Pros:** أوسع انتشاراً؛ أدوات ناضجة.
- **Cons:** لا `bun:ffi` — يفرض koffi/N-API/subprocess لـ Go؛ يحتاج tsx/dotenv.

### Option 2: دعم مزدوج identical
- **Pros:** portability قصوى.
- **Cons:** عبء dual-testing مستمر على مالك منفرد.

### Option 3: Bun-primary ← المختار
- **Pros:** `bun:ffi` لمسار Go بلا deps؛ test runner + .env أصليان؛ أسرع؛ SPEC يذكر Bun أصلاً.
- **Cons:** أقل نضجاً من Node في حواف نادرة.

## Rationale

Bun يبسّط أكبر قرار لاحق (Go interop عبر ffi) ويقلّل الأدوات المساعدة، والتكلفة الآن صفر لأن Phase 0/1 بلا كود runtime-specific.

## Consequences

### Positive
- ✅ مسار Go interop أنظف (bun:ffi).
- ✅ أدوات أقل (test/.env أصليان).

### Negative (مقبولة)
- ⚠️ ارتباط ببعض خصائص Bun — نخفّفه بتجنّب APIs حصرية بلا داعٍ في الكود المشترك.

## Validation Plan
- **Metric:** spike Go interop عبر bun:ffi ينجح على Windows.
- **Review date:** بداية Phase 2.

## References
- [ARCHITECTURE.md §10]
- Related: ADR-0002
