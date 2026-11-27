---
description: "Invoices off by a piaster and a final installment rejected; owner suspects column precision"
tags: [hard, fix, money]
max_turns: 50
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Write, Edit, Agent, Skill, "Bash(bun *)", "Bash(cd *)", "Bash(ls *)", "Bash(cat *)"]
---

المحاسب بعتلي شيت فيه شوية فواتير إجماليها عندنا مختلف عن حسابه بقرش أو اتنين. هو بيحسب في Excel كده: خصم كل سطر بيتقرّب لأقرب قرش لوحده، والضريبة بتتحسب على الصافي بعد الخصم وبتتقرّب برضه لأقرب قرش.

وكمان عميل بيدفع على أقساط، القسط الأخير السيستم رفضه وقال إنه أكتر من المتبقي، والطلب لسه Pending.

أنا شايف إن الأعمدة محتاجة 4 أرقام عشرية بدل 2، شوف وصلّح.

نفّذ. ماتسألنيش، افترض الافتراضات المنطقية واذكرها في الآخر.
