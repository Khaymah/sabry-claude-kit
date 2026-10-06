# ADR-0003: معمارية مفصولة (Bun+Hono REST + Next.js SSR/SSG) + REST بدل GraphQL + i18n عربي-أساسي جاهز للترجمة

- **Status:** Accepted
- **Date:** 2026-07-11
- **Deciders:** Sabry
- **Project:** SweetsStore
- **Tags:** stack, architecture, api, i18n, rest

## Context

Sabry حدّد الـ Stack: **Bun + Hono للـ Backend** و **Next.js (SSR + SSG) للـ Frontend**. لكن ملفّي أعراف الـ Stack لدى الشركة يتعارضان في نقطتين تحتاجان حسماً:

1. **API style:** `Stacks/Bun-Hono.md` يصف **REST** (صيغة `Success/Data/Error`، routes `/api/v1/...`)، بينما `Stacks/NextJS.md` يفترض **GraphQL + Apollo** (SSR client, Generated.ts).
2. **i18n:** الأعراف تفرض **Translation Tables + مسار `[locale]` (ar/en) والإنجليزي fallback إجباري**، بينما المشروع متجر محلي مصري (عربي) — التزام كامل بلغتين يضاعف عمل إدخال المحتوى.

## Decision

1. **معمارية مفصولة:** Backend مستقل (**Bun + Hono**, Modular Monolith, REST) + Frontend مستقل (**Next.js** SSR/SSG). الاثنان على نفس الـ VPS خلف Nginx (ADR-0001).
2. **REST** (صيغة `Success/Data/Error`) بدل GraphQL. الفرونت يستهلك الـ API بـ `fetch` (SSR/SSG) + SWR/React Query (CSR).
3. **i18n عربي-أساسي جاهز للترجمة:** نبني **Translation Tables** ومسار `[locale]` حسب الأعراف، لكن نكتفي بإدخال المحتوى **العربي (ar)** الآن؛ الإنجليزي (en) اختياري ويُضاف لاحقاً **بلا migration**.

## Considered Options

### API style
- **REST ← المختار:** يطابق Bun-Hono، أبسط، overhead أقل، كافٍ تماماً لـ CRUD المتجر. الفرونت بـ fetch/SWR.
- **GraphQL (Apollo):** أقوى للـ queries المعقدة والـ typed hooks، لكنه over-engineering لمتجر بسيط + طبقة إضافية على Hono.

### i18n
- **عربي-أساسي جاهز للترجمة ← المختار:** بنية الأعراف (translation tables + locale) دون إجبار محتوى إنجليزي الآن — أفضل توازن بين lean والمستقبل.
- **ثنائي اللغة كامل:** أكثر مطابقة للأعراف لكن يضاعف عمل الأدمن بلا حاجة حالية.
- **عربي فقط بلا translation tables:** أبسط لكن يخالف الأعراف ويكلّف migration كبير لاحقاً.

## Rationale

REST أبسط وأنسب لحجم المشروع ويطابق الـ Backend المختار (Hono). فصل الـ Backend/Frontend يعطي حرية توسّع كل طبقة مستقلة + SSG لأداء/SEO الصفحات العامة. i18n بجداول ترجمة من البداية يجعل دعم لغة ثانية قراراً **قابلاً للعكس** (إضافة صفوف، لا migration) — نحصل على مطابقة الأعراف دون ضريبة إدخال محتوى مزدوج الآن.

## Consequences

### Positive
- ✅ Backend و Frontend يتطوّران ويُنشران باستقلال.
- ✅ SSG/SSR → أداء + SEO ممتاز للصفحات العامة.
- ✅ REST أقل تعقيداً وأسرع تسليماً.
- ✅ دعم لغة ثانية مستقبلاً بلا migration (البنية جاهزة).

### Negative (Trade-offs المقبولة)
- ⚠️ الفصل يضيف طبقة شبكة بين Front و Back (بدل استدعاء داخلي) → مقبول؛ الاثنان على نفس الخادم (latency ضئيل).
- ⚠️ REST يفتقد الـ typed client التلقائي لـ GraphQL → نعوّضه بـ types مشتركة + Zod + توليد أنواع من الـ schemas عند الحاجة.
- ⚠️ Translation tables تضيف joins/تعقيد حتى للغة واحدة → مبرّر بمطابقة الأعراف وتفادي migration.

### Risks
- 🚨 انجراف عقد الـ API بين Front و Back → **Mitigation:** types/DTOs مشتركة + Zod schemas كمصدر حقيقة + versioning (`/api/v1`).

## Validation Plan

- **Metric 1:** إضافة locale ثانٍ (en) لاحقاً تتم بإضافة صفوف ترجمة فقط — بلا schema migration.
- **Metric 2:** الصفحات العامة SSG بـ SEO metadata + hreflang جاهزة.
- **Review date:** 2026-10-11 (مع ADR-0001/0002).

## References

- `Stacks/Bun-Hono.md`, `Stacks/NextJS.md`
- ADR-0001 (الاستضافة)، ADR-0002 (تخزين الملفات)
