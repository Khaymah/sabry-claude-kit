# /decide — قرار تقني بين خيارات

ساعدني أتخذ قراراً تقنياً بصفة CTO.

**الاستخدام:**
- `/decide "Hono vs Express لـ API جديد"` — قارن بين خيارين
- `/decide "monorepo vs separate repos"` — قرار معماري
- `/decide "SQL vs NoSQL لمشروع كذا"` — اختيار تقنية

## الإطار:
1. افهم السياق الكامل (لا تفترض)
2. قدّم مقارنة واضحة بجدول
3. وضّح متى كل خيار يكون الأفضل
4. اختر واحداً بشكل واضح مع السبب المبني على حالة Sabry تحديداً
5. اذكر الخطوة التالية العملية

**Arguments:** `$ARGUMENTS`

**Example:** `/decide "Hono vs Express لـ API جديد"`

**Output:**

```md
## القرار: Hono

| المعيار | Hono | Express |
|---|---|---|
| Runtime | Bun/Edge/Node نيتيف | Node أساساً، Bun بطبقة توافق |
| Types | end-to-end مع `hc` client | يدوي (`@types/express`) |
| Ecosystem | أصغر — middleware أقل | ضخم وناضج |
| خبرة الفريق | Stack الافتراضي | معروف بس مش افتراضي |

**ليه Hono هنا:** المشروع على Bun، والـ client محتاج types من الـ API مباشرة.
**بنضحّي بـ:** middleware جاهز (مثلاً passport) — هنكتب auth بـ `jose` بإيدينا.
**Express يكسب لو:** Node بس + اعتماد على middleware مش موجود لـ Hono.
**الخطوة الجاية:** route واحد + `hc` client كـ spike قبل ما نعمّم.
```
