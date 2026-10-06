# 📐 Architecture Decision Records (ADRs)

> سجل القرارات المعمارية المهمة عبر المشاريع.
> الهدف: تعرف "لماذا اخترنا X" بعد 6 أشهر — وليس "ماذا اخترنا".

## ما هو ADR؟

Architecture Decision Record هو مستند قصير يوثّق:
- **القرار** الذي اتُّخذ
- **السياق** الذي استدعى القرار
- **البدائل** التي رُفضت
- **العواقب** المتوقعة (Trade-offs)

> **ADR ليس documentation للكود** — هو documentation للـ **لماذا**.

## متى نكتب ADR؟

✅ **اكتب ADR عند:**
- اختيار technology / framework / vendor
- قرار معماري (microservices vs monolith، REST vs GraphQL)
- قرار يصعب التراجع عنه (one-way door)
- قرار سيتساءل عنه أي مطور جديد
- قرار تم بناءً على constraint غير ظاهر (legal, business, performance)

❌ **لا تكتب ADR عند:**
- قرارات implementation details (أين أضع الـ helper function)
- قرارات code style (مغطاة في linter)
- قرارات reversible بسهولة (CSS color)

## التنظيم

```
Decisions/
├── README.md              # هذا الملف
├── Global/                # قرارات تنطبق على كل المشاريع
│   ├── 0001-bun-as-default-runtime.md
│   └── 0002-drizzle-over-prisma.md
├── <ProjectName>/         # قرارات خاصة بمشروع
│   ├── 0001-modular-monolith.md
│   └── 0002-postgres-over-mongo.md
```

## ترقيم الـ ADRs

- ابدأ من `0001` لكل scope (Global / كل مشروع)
- الاسم: `<number>-<short-kebab-title>.md`
- **لا تعد ترقيم** الـ ADRs السابقة حتى لو تم تجاوزها

## ADR Status Lifecycle

```
Proposed → Accepted → [Deprecated | Superseded by ADR-XXXX]
```

- **Proposed** — مقترح قيد المناقشة
- **Accepted** — مُعتمد ومُنفّذ
- **Deprecated** — لم يعد ساري لكن لم يُستبدل
- **Superseded** — أُلغي واستُبدل بـ ADR-XXXX

## Template ADR

```markdown
# ADR-XXXX: [العنوان — جملة واحدة تصف القرار]

- **Status:** Proposed | Accepted | Deprecated | Superseded by ADR-YYYY
- **Date:** YYYY-MM-DD
- **Deciders:** [الأشخاص المعنيون]
- **Project:** Global | [اسم المشروع]
- **Tags:** [stack, architecture, security, performance, ...]

## Context (السياق)

[ما الذي دفعنا لاتخاذ هذا القرار؟]
- ما المشكلة التي نحلها؟
- ما القيود (constraints) — Technical / Business / Legal؟
- ما المعطيات (forces) المتعارضة؟

## Decision (القرار)

[القرار في جملة أو جملتين — بوضوح + بدون ambiguity]

## Considered Options (البدائل التي قُيِّمت)

### Option 1: [الاسم]
- **Pros:** ...
- **Cons:** ...

### Option 2: [الاسم]
- **Pros:** ...
- **Cons:** ...

### Option 3: [الاسم] ← المختار
- **Pros:** ...
- **Cons:** ...

## Rationale (لماذا الخيار المختار؟)

[2-4 جمل تشرح لماذا هذا الخيار أفضل في سياقنا تحديداً]

## Consequences (العواقب)

### Positive
- ✅ نتيجة 1
- ✅ نتيجة 2

### Negative (Trade-offs المقبولة)
- ⚠️ تضحية 1 + كيف نخفّفها
- ⚠️ تضحية 2

### Risks
- 🚨 خطر 1 + الـ mitigation

## Validation Plan

كيف نعرف لاحقاً إن كان القرار صحيحاً؟
- **Metric 1:** [مقياس + threshold]
- **Review date:** YYYY-MM-DD

## References

- [Link to RFC / Spec / Documentation]
- [Link to discussion / PR]
- [Related ADR-XXXX]
```

## مثال ADR (مرجعي)

```markdown
# ADR-0001: استخدام Bun كـ runtime افتراضي للـ Server

- **Status:** Accepted
- **Date:** 2026-02-15
- **Deciders:** Sabry
- **Project:** Global
- **Tags:** runtime, performance, stack

## Context

نحتاج runtime موحّد لكل مشاريع الـ backend الجديدة. الخيارات: Node.js, Deno, Bun.
المشروعات الجديدة تتطلب: TypeScript native، fast cold start (لـ serverless)، modern Web APIs.

## Decision

نستخدم **Bun** كـ runtime افتراضي لكل مشاريع backend جديدة.

## Considered Options

### Option 1: Node.js + tsx
- **Pros:** Ecosystem ناضج، LTS واضح، production-proven
- **Cons:** TypeScript يحتاج loader، cold start أبطأ، Web APIs ناقصة

### Option 2: Deno
- **Pros:** TypeScript native، Web APIs، security model جيد
- **Cons:** ecosystem أصغر، npm compatibility كانت محدودة (تحسّنت)

### Option 3: Bun ← المختار
- **Pros:** TypeScript native، 4× أسرع من Node، npm-compatible، .env تلقائي
- **Cons:** أحدث، potential bugs، Windows support كان محدود

## Rationale

أداء Bun + TypeScript native + npm compatibility = إنتاجية أعلى بدون التضحية بالـ ecosystem.
المشاكل المبكرة (Windows) حُلّت في 2025. أداء أفضل بـ 3-5× للـ HTTP throughput.

## Consequences

### Positive
- ✅ Dev experience أسرع (cold start < 100ms)
- ✅ TypeScript بدون build step
- ✅ .env تلقائي → كود أنظف

### Negative
- ⚠️ Lock-in على Bun-specific APIs (إذا استُخدمت) — نلتزم بـ Web standards
- ⚠️ Edge cases في native modules — نتحقق قبل dependency جديد

### Risks
- 🚨 Bun قد يتباطأ تطويره — Mitigation: الكود يلتزم بـ Web standards، انتقال لـ Deno ممكن

## Validation Plan

- **Metric 1:** HTTP throughput > 50k req/s على VPS متوسط
- **Review date:** 2026-08-15 (6 شهور)

## References

- [Bun benchmarks](https://bun.sh/benchmarks)
- ADR-0002 (Drizzle over Prisma)
```

## كيف نقرأ الـ ADRs؟

- عند **بدء مشروع جديد** — اقرأ Global ADRs
- عند **العمل على مشروع** — اقرأ Project-specific ADRs
- عند **مراجعة قرار قديم** — تحقق هل في ADR يفسره
- عند **سؤال "لماذا..."** — اعرض الـ ADR قبل التخمين

## القاعدة الذهبية

> **القرار بدون ADR = قرار سيُنسى → سيُعاد طرحه → سيُتخذ بشكل مختلف.**
> الـ ADRs هي ذاكرة الفريق الجماعية.
