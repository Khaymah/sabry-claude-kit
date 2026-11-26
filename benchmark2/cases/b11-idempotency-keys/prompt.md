---
description: "Build Idempotency-Key support so mobile retries never create duplicate orders or payments"
tags: [hard, build, idempotency]
max_turns: 50
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Write, Edit, Agent, Skill, "Bash(bun *)", "Bash(cd *)", "Bash(ls *)", "Bash(cat *)"]
---

تطبيق الموبايل بتاعنا لما النت يقطع بيعيد إرسال الطلب تلقائي، والنتيجة طلبات ودفعات مكررة. فريق الموبايل هيبعت header اسمه `Idempotency-Key` (نص لحد 255 حرف) مع كل `POST /Orders` و `POST /Payments`، وعايزين الباك إند يتعامل معاه.

المطلوب:
- لو نفس المفتاح جه تاني بنفس الطلب بالظبط، يرجع نفس الرد الأولاني (نفس الـ status ونفس الـ body) من غير ما يتعمل أي حاجة جديدة.
- لو نفس المفتاح جه بطلب مختلف: 422 والكود `IDEMPOTENCY_KEY_REUSED`.
- لو الطلب الأولاني لسه شغال والتاني وصل: يا إما يستنى ويرجع نفس الرد، يا إما يرجع 409. المهم ميتعملش حاجة مرتين.
- المفاتيح خاصة بكل شركة لوحدها، وتفضل صالحة 24 ساعة، بعدها نفس المفتاح يعتبر طلب جديد.
- الطلبات اللي من غير المفتاح تفضل شغالة زي ما هي.

نفّذ. ماتسألنيش، افترض الافتراضات المنطقية واذكرها في الآخر.
