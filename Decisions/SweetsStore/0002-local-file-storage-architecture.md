# ADR-0002: معمارية تخزين الملفات المحلي — Chunked Upload + Streaming + Optimization + فصل عام/خاص

- **Status:** Accepted
- **Date:** 2026-07-11
- **Deciders:** Sabry
- **Project:** SweetsStore
- **Tags:** storage, security, performance, files, uploads

## Context

المشروع يتعامل مع نوعين من الملفات:
1. **صور المنتجات** — عامة، تُعرض لكل الزوار.
2. **صور إثبات التحويل** — **حسّاسة (بيانات مالية + PII)**، لا يجب أن يراها إلا الأدمن.

القرار (من Sabry): التخزين **محلي على الـ VPS** مع **Streaming + Upload Chunking + Optimization**. نحتاج تصميماً يمنع تسريب الملفات الحسّاسة، ويرفع/يخدم الملفات بكفاءة بلا استهلاك ذاكرة مفرط.

## Decision

نخزّن الملفات على قرص الـ VPS في مجلد **خارج web root وخارج `public/`**، مع:
- **فصل عام/خاص:** `uploads/public/` (صور المنتجات) و `uploads/private/` (إثباتات التحويل).
- **Upload Chunking:** رفع مُقطّع من العميل → إعادة تجميع على الخادم في مجلد مؤقت ثم نقل atomic.
- **Optimization:** معالجة الصور بـ `sharp` عند الرفع (resize + compress + WebP + توليد thumbnails + **إزالة EXIF**).
- **Streaming للخدمة:** الملفات العامة يخدمها **Nginx مباشرة** (مع caching)، والملفات الخاصة تُخدَم فقط عبر **route مُصادَق عليه** في Next.js يستخدم **Nginx `X-Accel-Redirect`** (التطبيق يُصرّح، Nginx يبثّ الملف بكفاءة).
- **طبقة تخزين مجرّدة (Storage abstraction):** واجهة واحدة (`put/get/stream/delete`) تعزل الكود عن الـ backend لتسهيل النقل لـ S3-compatible لاحقاً.

## Considered Options

### Option 1: تخزين في `public/` وخدمة مباشرة
- **Pros:** أبسط، Nginx يخدم كل شيء.
- **Cons:** **كارثة أمنية** — إثباتات التحويل تصبح متاحة لأي شخص بالرابط (URL guessing). مرفوض.

### Option 2: خدمة كل الملفات عبر التطبيق (بلا X-Accel)
- **Pros:** تحكم كامل في الصلاحيات.
- **Cons:** التطبيق يقرأ الملف في الذاكرة/يمرّره → استهلاك RAM + بطء عند الحمل. لا يستفيد من كفاءة Nginx.

### Option 3: فصل عام/خاص + X-Accel-Redirect للخاص + sharp ← المختار
- **Pros:** أمان قوي (الخاص خلف auth)، كفاءة عالية (Nginx يبثّ)، صور مُحسّنة، ذاكرة منخفضة، طبقة مجرّدة قابلة للنقل.
- **Cons:** إعداد أعقد قليلاً (Nginx internal locations + chunking logic).

## Rationale

الفصل بين العام والخاص + `X-Accel-Redirect` يعطي **أمان الملفات الخاصة** (لا رابط مباشر أبداً — كل وصول يمرّ على تحقّق RBAC) **مع** كفاءة بثّ Nginx (بلا تحميل الملف في ذاكرة Node). `sharp` يقلّل حجم التخزين والـ bandwidth ويزيل EXIF (يمنع تسريب GPS/metadata). الطبقة المجرّدة تحوّل «التخزين المحلي» لقرار قابل للعكس (Two-way door) — ننتقل لـ R2/MinIO لاحقاً بتغيير adapter واحد.

## Consequences

### Positive
- ✅ إثباتات التحويل غير قابلة للوصول إلا بعد تحقّق صلاحية الأدمن.
- ✅ خدمة ملفات عالية الكفاءة (Nginx) بذاكرة منخفضة (streaming).
- ✅ صور أصغر وأسرع (WebP + thumbnails + بلا EXIF).
- ✅ رفع مقاوم للانقطاع + بلا memory spikes (chunking).
- ✅ قابلية نقل لطبقة تخزين سحابية بلا إعادة كتابة (abstraction).

### Negative (Trade-offs المقبولة)
- ⚠️ تعقيد إعداد Nginx (internal `location` + `X-Accel-Redirect`) → موثّق في runbook.
- ⚠️ منطق chunking (reassembly/cleanup) → نستخدم مكتبة ناضجة + تنظيف دوري للمؤقتات الفاشلة.

### Risks
- 🚨 رفع ملف خبيث (متنكّر كصورة) → **Mitigation:** تحقّق **magic bytes** (لا الامتداد فقط) + حد حجم/أبعاد + `sharp` re-encode (يُبطل payloads مخبأة) + منع تنفيذ في مجلد uploads (Nginx).
- 🚨 امتلاء القرص بملفات مؤقتة فاشلة → **Mitigation:** TTL + cron cleanup للـ chunks غير المكتملة.
- 🚨 استنزاف مساحة القرص بالنمو → **Mitigation:** مراقبة المساحة + سياسة retention + خطة نقل لـ object storage.

## Validation Plan

- **Metric 1:** محاولة وصول مباشر لملف خاص بلا auth → **يُرفض دائماً** (اختبار أمني).
- **Metric 2:** رفع صورة 5MB يكتمل بلا تجاوز memory متوقّع على الخادم.
- **Metric 3:** حجم صور المنتجات بعد التحسين < X% من الأصل.
- **Review date:** 2026-10-11 (مع ADR-0001).

## References

- ADR-0001 (الاستضافة الذاتية على VPS) — القرار الأصل
- `sharp`, Nginx `X-Accel-Redirect` docs
- OWASP File Upload Cheat Sheet
