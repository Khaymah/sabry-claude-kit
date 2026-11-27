---
description: "Build partial refunds on payments"
tags: [hard, build, money]
max_turns: 50
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Write, Edit, Agent, Skill, "Bash(bun *)", "Bash(cd *)", "Bash(ls *)", "Bash(cat *)"]
---

عايزين نعمل مرتجعات جزئية على الدفعات (العميل دفع 100 ونرجّعله 30 النهارده و20 بكرة).
- `POST /Payments/:Id/Refunds` بـ `{ Amount, Reason? }`. مجموع المرتجعات ميعديش مبلغ الدفعة (لو عدّى: 409).
- `GET /Payments/:Id/Refunds` يرجّع `{ Items, RefundedAmount, RefundableAmount }`.
- لما كل فلوس الطلب ترجع، الطلب يبقى `Refunded`.

نفّذ. ماتسألنيش، افترض الافتراضات المنطقية واذكرها في الآخر.
