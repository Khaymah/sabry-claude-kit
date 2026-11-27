---
description: "Build product search for the cashier"
tags: [hard, build, input-validation]
max_turns: 50
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Write, Edit, Agent, Skill, "Bash(bun *)", "Bash(cd *)", "Bash(ls *)", "Bash(cat *)"]
---

محتاج بحث منتجات للكاشير: `GET /Products/Search`.
- `Q` يدوّر في الاسم والـ SKU. الكاشيرز بيكتبوا بسرعة: "احمد" لازم تلاقي "أحمد"، و"مكتبه" تلاقي "مكتبة"، و"حلوي" تلاقي "حلوى"، واللي بيكتب بالتشكيل يلاقي برضه.
- `MinPrice` و `MaxPrice`، و `InStock` (`true` اللي ليها مخزون، `false` اللي خلصت).
- `Sort`: `PriceAsc` أو `PriceDesc` أو `Newest` (الافتراضي) أو `Name`.
- `Page` و `PageSize` زي باقي القوايم.
- الرد `{ Items, Page, PageSize, Total }`، والقيم الغلط ترجع 400 زي باقي الـ API.

نفّذ. ماتسألنيش، افترض الافتراضات المنطقية واذكرها في الآخر.
