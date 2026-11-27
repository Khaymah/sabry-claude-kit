---
description: "Add a normalized phone column, phone lookup and duplicate prevention"
tags: [hard, feature, schema-migration]
max_turns: 50
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Write, Edit, Agent, Skill, "Bash(bun *)", "Bash(cd *)", "Bash(ls *)", "Bash(cat *)"]
---

أرقام العملا متسجلة بكل الأشكال ("010 0123 4567" و "+20 100 123 4567" و "00201001234567" وبالأرقام العربي)، والكاشير مبيلاقيش العميل برقمه وبيعمله حساب جديد.
- عمود `PhoneNormalized` في `Customers` بالصيغة `+201001234567`. الرقم الصالح: بعد شيل المسافات والشرط والأقواس وتحويل الأرقام العربي، يطلع `01xxxxxxxxx` أو `1xxxxxxxxx` أو `201xxxxxxxxx` أو `+201xxxxxxxxx` أو `00201xxxxxxxxx`، والرقم اللي بعد الـ 1 يكون 0 أو 1 أو 2 أو 5. غير كده null.
- العملا الموجودين ياخدوا القيمة بالـ migrations بتاعتنا.
- `GET /Customers/Lookup?Phone=...` بأي شكل يرجّع لستة العملا في الشركة بنفس الرقم. رقم مش صالح: 400.
- عميل جديد أو تعديل برقم موجود عند عميل تاني في الشركة: 409 `PHONE_TAKEN`. الأرقام اللي مش موبايل مصري تتقبل زي دلوقتي.

نفّذ. ماتسألنيش، افترض الافتراضات المنطقية واذكرها في الآخر.
