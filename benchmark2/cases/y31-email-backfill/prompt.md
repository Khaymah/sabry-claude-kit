---
description: "Add case-insensitive customer email lookup and stop new duplicate emails"
tags: [hard, feature, schema-migration]
max_turns: 50
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Write, Edit, Agent, Skill, "Bash(bun *)", "Bash(cd *)", "Bash(ls *)", "Bash(cat *)"]
---

عايزين نبدأ نبعت فواتير للعملا على الإيميل، بس الإيميلات عندنا متسجلة بأشكال مختلفة (حروف كابيتال، مسافات في الأول والآخر)، وفيه عملا متسجلين أكتر من مرة.

- عمود `EmailNormalized` في `Customers`: الإيميل من غير مسافات في الأول والآخر وكله حروف صغيرة. العملا الموجودين ياخدوا القيمة بالـ migrations بتاعتنا.
- `GET /Customers/Lookup?Email=...` يرجّع لستة العملا في الشركة اللي ليهم نفس الإيميل بغض النظر عن الكابيتال والمسافات.
- من النهارده: عميل جديد أو تعديل بإيميل موجود عند عميل تاني في نفس الشركة: 409 بالكود `EMAIL_TAKEN`. العميل من غير إيميل عادي.
- الإيميل الأصلي يفضل زي ما هو.

نفّذ. ماتسألنيش، افترض الافتراضات المنطقية واذكرها في الآخر.
