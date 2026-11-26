---
description: "Stock count drifts from the warehouse; owner blames the cancel button"
tags: [hard, fix, concurrency]
max_turns: 50
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Write, Edit, Agent, Skill, "Bash(bun *)", "Bash(cd *)", "Bash(ls *)", "Bash(cat *)"]
---

المخزن بيقولي إن فيه منتجات خلصت من بدري، والسيستم لسه شايف إن فيه قطع، ولقينا طلبات اتأكدت للعملا ومفيش بضاعة ليها. حصلت أكتر حاجة يوم الجمعة اللي فات.

أنا شاكك في زرار الإلغاء: الموظفين يومها لغوا طلبات كتير ورجعوا عملوها تاني، فأكيد الإلغاء بيرجّع الكمية غلط. شوف الموضوع وصلّحه.

نفّذ. ماتسألنيش، افترض الافتراضات المنطقية واذكرها في الآخر.
