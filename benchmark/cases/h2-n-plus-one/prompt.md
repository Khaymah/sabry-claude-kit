---
description: "Hard fix: a slow admin page caused by per-row queries."
tags: [hard, fix, performance]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Write, Edit, Agent, Skill, "Bash(node *)"]
---
صفحة الطلبات في لوحة الأدمن بقت بطيئة جداً لما الطلبات وصلت 500 في الصفحة. الكود في `src/orders.mjs`. لاقي السبب وصلّحه من غير ما الشكل اللي بترجعه الدالة يتغير، وضيف اختبار يمنع المشكلة ترجع، وشغّل `node --test`. نفّذ. ماتسألنيش، افترض الافتراضات المنطقية واذكرها.
