---
description: "Hard fix: overselling under concurrent purchases."
tags: [hard, fix, concurrency]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Write, Edit, Agent, Skill, "Bash(node *)"]
---
في الـ flash sale بعنا 9 قطع من منتج المخزون بتاعه كان 5. صلّح `purchase` في `src/shop.mjs` بحيث مستحيل نبيع أكتر من المخزون حتى لو 20 طلب وصلوا في نفس اللحظة، وضيف اختبار يثبت ده وشغّل `node --test`. نفّذ. ماتسألنيش، افترض الافتراضات المنطقية واذكرها.
