---
description: "Build a product search endpoint with strict query validation and Arabic-aware matching"
tags: [hard, build, input-validation]
max_turns: 50
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Write, Edit, Agent, Skill, "Bash(bun *)", "Bash(cd *)", "Bash(ls *)", "Bash(cat *)"]
---

محتاج بحث في المنتجات للكاشير وللموقع: `GET /Products/Search`.

الـ query parameters:
- `Q`: نص البحث (اختياري، لحد 100 حرف بعد ما نشيل المسافات من الأول والآخر). يدوّر في اسم المنتج والـ SKU، ومش بيفرق كابيتال وسمول. الكاشير بيكتب بسرعة: لو كتب "احمد" لازم يلاقي "أحمد"، و"مكتبه" يلاقي "مكتبة"، و"حلوي" يلاقي "حلوى"، ولو حد كتب بالتشكيل يلاقي برضه. وأي رموز زي % أو _ تتعامل كحروف عادية.
- `MinPrice` و `MaxPrice`: أسعار بالشكل العادي بس (زي 10 أو 10.5 أو 10.50)، والحد الأدنى ميبقاش أكبر من الأقصى. والفلتر شامل الحدين.
- `InStock`: `true` يجيب اللي ليها مخزون بس، `false` يجيب اللي خلصت بس.
- `Sort`: واحدة من `PriceAsc` أو `PriceDesc` أو `Newest` أو `Name`، والافتراضي `Newest`.
- `Page` من 1 لـ 1000 (افتراضي 1)، و `PageSize` من 1 لـ 50 (افتراضي 20). أرقام صحيحة عادية بس.

أي قيمة مش مظبوطة: 400 `VALIDATION_ERROR`، منقربش ونصلّح من عندنا. الرد: `{ Items, Page, PageSize, Total }`. المنتجات المتوقفة وبتاعة الشركات التانية متظهرش.

نفّذ. ماتسألنيش، افترض الافتراضات المنطقية واذكرها في الآخر.
