---
description: "Orders list slow for the biggest tenant and its accountant sees duplicates/missing orders while paging; owner blames new orders arriving"
tags: [hard, fix, performance]
max_turns: 50
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Write, Edit, Agent, Skill, "Bash(bun *)", "Bash(cd *)", "Bash(ls *)", "Bash(cat *)"]
---

من ساعة ما العميل الكبير نقل الداتا القديمة بتاعته عندنا، صفحة الطلبات عنده بقت بطيئة جداً. والمحاسب بتاعه بيقلب الصفحات علشان يراجع، وبيقول إن فيه طلبات بتتكرر وطلبات مبتظهرش خالص.

أنا شايف إن ده علشان الطلبات الجديدة بتدخل وهو بيقلّب، فمش مشكلة كبيرة. بس السرعة لازم تتحل، يمكن نعمل cache؟

نفّذ. ماتسألنيش، افترض الافتراضات المنطقية واذكرها في الآخر.
