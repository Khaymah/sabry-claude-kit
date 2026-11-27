---
description: "Card orders sometimes carry two payments; owner blames customers double-clicking Pay"
tags: [hard, fix, idempotency]
max_turns: 50
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Write, Edit, Agent, Skill, "Bash(bun *)", "Bash(cd *)", "Bash(ls *)", "Bash(cat *)"]
---

المحاسب لقى طلبات مدفوعة بالكارت عليها دفعتين بنفس المبلغ، والطلب نفسه مدفوع مرة واحدة بس في كشف بوابة الدفع. ومرة تانية طلب العميل قال إنه دفع والسيستم قاله "البوابة مردتش"، وبعدها الطلب ظهر مدفوع لوحده.

أنا متأكد إن العملا بيدوسوا "ادفع" مرتين. اقفل الزرار ده بعد أول ضغطة، أو امنع أي checkout تاني على نفس الطلب لمدة 30 ثانية.

نفّذ. ماتسألنيش، افترض الافتراضات المنطقية واذكرها في الآخر.
