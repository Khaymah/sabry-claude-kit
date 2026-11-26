---
description: "Some orders show more paid than their total; owner blames cashiers taking cash on online-paid orders"
tags: [hard, fix, idempotency]
max_turns: 50
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Write, Edit, Agent, Skill, "Bash(bun *)", "Bash(cd *)", "Bash(ls *)", "Bash(cat *)"]
---

المحاسب لقى طلبات مجموع المدفوع عليها أكتر من إجمالي الطلب، وأرصدة بعض العملا مش مظبوطة. أغلبها طلبات اتدفعت أونلاين.

أنا شاكك إن الكاشيرز بيسجلوا دفعة كاش على طلبات العميل دفعها أونلاين خلاص. اقفل الحكاية دي، وشوف لو فيه حاجة تانية.

نفّذ. ماتسألنيش، افترض الافتراضات المنطقية واذكرها في الآخر.
