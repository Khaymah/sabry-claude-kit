---
description: "Add per-company sequential order numbers"
tags: [hard, feature, schema-migration]
max_turns: 50
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Write, Edit, Agent, Skill, "Bash(bun *)", "Bash(cd *)", "Bash(ls *)", "Bash(cat *)"]
---

العملا عايزين رقم طلب خاص بكل شركة يبدأ من 1 ومتسلسل من غير فجوات (المحاسبين بيطلبوه كده للفواتير).
- عمود `OrderNumber` يظهر في ردود الطلبات.
- الطلبات القديمة تاخد أرقامها حسب تاريخ الإنشاء جوه كل شركة (ولو نفس التاريخ، الأقدم Id)، والجديدة تكمّل بعدها. الطلب الملغي بيحتفظ برقمه.
- `GET /Orders/ByNumber/:Number` يجيب الطلب بالرقم ده في الشركة (مش موجود: 404).

نفّذ. ماتسألنيش، افترض الافتراضات المنطقية واذكرها في الآخر.
