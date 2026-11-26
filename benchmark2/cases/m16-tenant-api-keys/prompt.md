---
description: "Add per-company API keys for ERP integrations with a strict allow-list"
tags: [hard, feature, tenant-isolation]
max_turns: 50
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Write, Edit, Agent, Skill, "Bash(bun *)", "Bash(cd *)", "Bash(ls *)", "Bash(cat *)"]
---

فيه شركات عندنا عايزة تربط الـ ERP بتاعها بالسيستم علشان تسحب المنتجات والطلبات وتعمل طلبات أوتوماتيك، ومش عايزين يستخدموا يوزر وباسورد حد من الموظفين.

المطلوب:
- صاحب الشركة بس (Owner) يقدر يعمل مفتاح: `POST /ApiKeys` بـ `{ Name }`، والرد فيه المفتاح نفسه في `Key` ودي المرة الوحيدة اللي هيشوفه فيها. `GET /ApiKeys` يعرض مفاتيح شركته من غير المفتاح نفسه، و `DELETE /ApiKeys/:Id` يوقف المفتاح فوراً.
- الـ ERP هيبعت المفتاح في header اسمه `X-Api-Key`.
- المفتاح يشتغل على الحاجات دي بس، وعلى داتا شركته بس: قراءة المنتجات (`GET /Products` و `GET /Products/:Id`)، قراءة الطلبات (`GET /Orders` و `GET /Orders/:Id`)، وعمل طلب (`POST /Orders`). أي حاجة تانية بالمفتاح: 403.
- مفتاح غلط أو متوقف: 401.
- لو حد سرق نسخة من الداتابيز ميقدرش يستخدم المفاتيح.
- الموظفين اللي داخلين بالـ session العادية ميتأثروش خالص.

نفّذ. ماتسألنيش، افترض الافتراضات المنطقية واذكرها في الآخر.
