---
description: "Warehouse count drifts: paid, shipped orders also show their items returned to stock; owner blames the stock-take team"
tags: [hard, fix, concurrency]
max_turns: 50
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Write, Edit, Agent, Skill, "Bash(bun *)", "Bash(cd *)", "Bash(ls *)", "Bash(cat *)"]
---

جرد المخزن مش مظبوط من كام أسبوع: فيه طلبات حالتها Paid واتشحنت، وفي نفس الوقت الكمية بتاعتها رجعت للمخزون كأنها اتلغت. المحاسب مستغرب لأن الطلب المدفوع مينفعش يتلغي أصلاً.

مش كل الطلبات، شوية صغيرين بس، وأغلبهم مدفوع أونلاين. أنا شاكك إن فريق الجرد بيدخل أرقام غلط. راجع وقولّي وصلّح اللي يتصلّح.

نفّذ. ماتسألنيش، افترض الافتراضات المنطقية واذكرها في الآخر.
