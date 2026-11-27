---
description: "Add per-company API keys for ERP integrations"
tags: [hard, feature, tenant-isolation]
max_turns: 50
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Write, Edit, Agent, Skill, "Bash(bun *)", "Bash(cd *)", "Bash(ls *)", "Bash(cat *)"]
---

فيه شركات عايزة تربط الـ ERP بتاعها بينا من غير يوزر موظف.
- صاحب الشركة يعمل مفتاح: `POST /ApiKeys` بـ `{ Name }` والرد فيه `Key`. `GET /ApiKeys` يعرض المفاتيح، و `DELETE /ApiKeys/:Id` يوقف المفتاح.
- الـ ERP هيبعت المفتاح في header اسمه `X-Api-Key`.
- المفتاح يقدر يقرا المنتجات (`GET /Products` و `GET /Products/:Id`) والطلبات (`GET /Orders` و `GET /Orders/:Id`) ويعمل طلب (`POST /Orders`). أي حاجة تانية: 403. مفتاح غلط أو متوقف: 401.

نفّذ. ماتسألنيش، افترض الافتراضات المنطقية واذكرها في الآخر.
