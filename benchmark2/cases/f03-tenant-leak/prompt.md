---
description: "A tenant's stock and prices change on their own; owner suspects one of the tenant's employees"
tags: [hard, fix, tenant-isolation]
max_turns: 50
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Write, Edit, Agent, Skill, "Bash(bun *)", "Bash(cd *)", "Bash(ls *)", "Bash(cat *)"]
---

شركة "بيتا" عندنا بتشتكي إن مخزون منتج عندهم بيقل لوحده من غير طلبات عندهم، ومرة سعر منتج اتغير لوحده لـ 0.01. وقبلها بيوم عميل عندهم قال إن لما فتح طلبه شاف اسم عميل غريب.

أنا متأكد إن فيه موظف عندهم بيلعب في السيستم. عايز أعرف مين: ضيف حاجة تسجل مين عدّل المنتجات، وصلّح أي حاجة تانية تلاقيها في السكة.

نفّذ. ماتسألنيش، افترض الافتراضات المنطقية واذكرها في الآخر.
