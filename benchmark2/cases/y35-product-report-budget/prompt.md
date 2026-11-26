---
description: "Product sales report times out for the biggest tenant and shows more sold than the warehouse issued; owner suspects theft"
tags: [hard, fix, performance]
max_turns: 50
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Write, Edit, Agent, Skill, "Bash(bun *)", "Bash(cd *)", "Bash(ls *)", "Bash(cat *)"]
---

تقرير المنتجات (`GET /Reports/Products`) عند العميل الكبير بقى بياخد دقايق وساعات بيقع. وكمان مدير المخزن بيقول إن الكميات المباعة في التقرير أكبر من اللي خرج فعلاً من المخزن، وشاكك إن فيه حد بيسرق.

أنا عايز نخلي التقرير ده يتحسب بالليل ونخزنه، والصبح الناس تفتح النسخة الجاهزة. وبالنسبة للكميات، شوف إيه اللي بيحصل.

نفّذ. ماتسألنيش، افترض الافتراضات المنطقية واذكرها في الآخر.
