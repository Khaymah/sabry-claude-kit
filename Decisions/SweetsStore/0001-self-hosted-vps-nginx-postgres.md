# ADR-0001: استضافة ذاتية على VPS مع Nginx و PostgreSQL (بدل PaaS مُدار)

- **Status:** Accepted
- **Date:** 2026-07-11
- **Deciders:** Sabry
- **Project:** SweetsStore
- **Tags:** stack, infrastructure, hosting, self-hosted, cost, availability

## Context

موقع حلويات MVP بمعمارية مفصولة (**Backend: Bun + Hono REST · Frontend: Next.js SSR/SSG**): كتالوج منتجات + سلة + أوردرات + داشبورد أدمن + رفع صور (منتجات + إثباتات تحويل). المطلوب: تكلفة منخفضة/ثابتة، تحكم كامل، وقابلية توسّع مستقبلي بلا إعادة كتابة.

**القيود:**
- التكلفة عامل مهم — يُفضَّل تكلفة ثابتة يمكن التنبؤ بها بدل per-service/egress متغيّر.
- Sabry يملك خبرة DevOps (Docker/Nginx/VPS) → العبء التشغيلي مقبول.
- أعراف الشركة: PostgreSQL + Drizzle (TEXT over VARCHAR، uuidv7، soft-delete).
- رفع ملفات محلي مطلوب (قرار منفصل: ADR-0002).

## Decision

نستضيف التطبيق على **VPS واحد** (Hetzner/DigitalOcean/Contabo) خلف **Nginx** كـ reverse proxy + TLS، و**PostgreSQL مُستضاف ذاتياً** على نفس الخادم (عبر Docker Compose). التطبيق خدمتان على نفس الخادم: **Bun + Hono (Backend/REST)** و **Next.js (Frontend SSR/SSG)**، و Nginx يوجّه بينهما. لا نستخدم PaaS مُدار (Vercel/Supabase) ولا Cloudflare D1.

## Considered Options

### Option 1: Vercel + Supabase (managed PaaS)
- **Pros:** أسرع إعداد، zero-ops، free tier، auto-scaling، Postgres مُدار.
- **Cons:** تكلفة متغيّرة تكبر مع النمو، تخزين ملفات مُدار (مش محلي كما طُلب)، lock-in، egress محتمل.

### Option 2: كله Cloudflare (Workers + D1 + R2)
- **Pros:** مورّد واحد، أرخص compute، R2 بلا egress، edge.
- **Cons:** D1 = SQLite يخالف أعراف Postgres، احتكاك مع Next.js، لا يناسب التخزين المحلي المطلوب.

### Option 3: VPS ذاتي + Nginx + Postgres ← المختار
- **Pros:** **تكلفة ثابتة ومنخفضة** (~$5–20/شهر لكل شيء)، تحكم كامل، تخزين ملفات محلي طبيعي، لا egress/per-service، Postgres native يطابق الأعراف، سهل النقل (portable).
- **Cons:** **عبء تشغيلي** (تحديثات، backups، TLS، hardening)، **VPS واحد = SPOF**، لا auto-scaling، التخزين المحلي يقيّد الـ horizontal scaling.

## Rationale

التكلفة الثابتة المنخفضة + التحكم الكامل + التوافق الطبيعي مع «تخزين ملفات محلي» + خبرة Sabry التشغيلية تجعل VPS الخيار الأنسب لهذا المشروع تحديداً. Postgres native يحفظ أعراف الشركة (بعكس D1). العبء التشغيلي مقبول ومُدار عبر Docker Compose + أتمتة بسيطة.

## Consequences

### Positive
- ✅ تكلفة شهرية ثابتة ومتوقّعة، بلا مفاجآت egress/storage.
- ✅ تحكم كامل في البيئة + تخزين محلي مباشر للملفات.
- ✅ Postgres + Drizzle = توافق تام مع أعراف الشركة → Maintainability أعلى.
- ✅ Portable — قابل للنقل لأي VPS/سحابة بلا lock-in.

### Negative (Trade-offs المقبولة)
- ⚠️ **عبء تشغيلي** (updates/backups/hardening) → نخففه بـ Docker Compose + Certbot auto-renew + nightly backups مؤتمتة.
- ⚠️ **SPOF (خادم واحد)** → مقبول للـ MVP؛ نخففه بـ backups مُختبَرة الاستعادة + snapshots دورية من مزوّد الـ VPS.
- ⚠️ **التخزين المحلي يقيّد horizontal scaling** → مقبول الآن؛ خطة الخروج = نقل الملفات لـ S3-compatible (R2/MinIO) عند الحاجة للتوسّع الأفقي (ADR-0002 يعزل طبقة التخزين لتسهيل ذلك).

### Risks
- 🚨 فقدان البيانات عند فشل القرص → **Mitigation:** nightly `pg_dump` + rsync لمجلد الملفات إلى موقع خارجي (object store رخيص/خادم آخر)، + snapshots، + اختبار استعادة دوري.
- 🚨 ثغرة أمنية على خادم مكشوف → **Mitigation:** firewall (ufw)، SSH keys فقط + منع root login، fail2ban، تحديثات أمنية، TLS 1.3، Nginx hardening.

## Validation Plan

- **Metric 1:** تكلفة شهرية إجمالية ثابتة ضمن الميزانية المستهدفة.
- **Metric 2:** استعادة ناجحة من backup في < 30 دقيقة (DR drill).
- **Metric 3:** uptime شهري مقبول للـ MVP (متابعة بسيطة عبر uptime monitor مجاني).
- **Review date:** 2026-10-11 (3 شهور) — نعيد التقييم لو الحمل أو الحاجة للتوافرية العالية زادت.

## References

- [MVP-Plan.md](../../../..) — خطة المشروع
- ADR-0002 (معمارية تخزين الملفات المحلي) — قرار مكمّل
