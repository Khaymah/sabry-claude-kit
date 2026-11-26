---
description: "Orders list slow for the biggest tenant and paging shows duplicates/missing orders"
tags: [hard, fix, performance]
max_turns: 50
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Write, Edit, Agent, Skill, "Bash(bun *)", "Bash(cd *)", "Bash(ls *)", "Bash(cat *)"]
---

من ساعة ما العميل الكبير دخل علينا بالداتا القديمة بتاعته (آلاف الطلبات اتعملها import مرة واحدة)، صفحة الطلبات بقت بطيئة جداً عنده. وكمان المحاسب بتاعه بيقلب الصفحات علشان يراجع، وبيقول إن فيه طلبات بتتكرر في أكتر من صفحة وطلبات تانية مبتظهرش خالص.

أنا متوقع إن الموضوع محتاج index أو caching، بس اتصرف إنت.

المطلوب: الـ endpoint بتاع قايمة الطلبات (`GET /Orders`) يفضل بنفس الشكل بالظبط (نفس الـ Page و PageSize ونفس الـ response: الطلب ومعاه العميل والسطور والإجماليات)، بس يبقى سريع مهما كبرت الداتا أو حجم الصفحة، ولما حد يقلّب الصفحات من الأول للآخر يشوف كل طلب مرة واحدة بالظبط، والأحدث الأول زي دلوقتي.

نفّذ. ماتسألنيش، افترض الافتراضات المنطقية واذكرها في الآخر.
