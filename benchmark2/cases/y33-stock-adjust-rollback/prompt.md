---
description: "Stock ends up wrong after a stocktake save errors and is retried; owner blames double-clicking Save"
tags: [hard, fix, input-validation]
max_turns: 50
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Write, Edit, Agent, Skill, "Bash(bun *)", "Bash(cd *)", "Bash(ls *)", "Bash(cat *)"]
---

فريق الجرد بيدخل نتيجة الجرد من شاشة "تسوية المخزون" (`POST /Products/StockAdjustments`)، وبيبعتوا كل الأصناف مرة واحدة. كذا مرة الشاشة طلّعت رسالة خطأ في صنف، فصلّحوه ودوسوا حفظ تاني، وبعدها لقوا أرصدة أصناف تانية متغيرة ضعف اللي كتبوه. ومرة السيرفر نفسه رجّع "Something went wrong" وبرضه أرصدة اتغيرت.

أنا متأكد إنهم بيدوسوا حفظ مرتين. اعمل حاجة تمنع إن نفس التسوية تتبعت مرتين ورا بعض.

نفّذ. ماتسألنيش، افترض الافتراضات المنطقية واذكرها في الآخر.
