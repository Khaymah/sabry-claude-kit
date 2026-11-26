---
description: "Build Idempotency-Key support on order and payment creation"
tags: [hard, build, idempotency]
max_turns: 50
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Write, Edit, Agent, Skill, "Bash(bun *)", "Bash(cd *)", "Bash(ls *)", "Bash(cat *)"]
---

تطبيق الموبايل بيعيد إرسال الطلبات لما النت يقطع، وفريق الموبايل هيبعت header اسمه `Idempotency-Key` مع `POST /Orders` و `POST /Payments`، زي ما Stripe بيعمل.
- نفس المفتاح بنفس الطلب: يرجع نفس الرد الأولاني.
- نفس المفتاح بطلب مختلف: 422 بالكود `IDEMPOTENCY_KEY_REUSED`.
- المفتاح يفضل صالح 24 ساعة.

نفّذ. ماتسألنيش، افترض الافتراضات المنطقية واذكرها في الآخر.
