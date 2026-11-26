---
description: "Build partial refunds on payments with exact money handling"
tags: [hard, build, money]
max_turns: 50
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Write, Edit, Agent, Skill, "Bash(bun *)", "Bash(cd *)", "Bash(ls *)", "Bash(cat *)"]
---

محتاج نعمل مرتجعات (Refunds) جزئية على الدفعات. يعني العميل دفع 100 جنيه، نرجّعله 30 النهارده و20 بكرة وهكذا.

المطلوب:
- `POST /Payments/:Id/Refunds` بـ `{ Amount, Reason? }` يعمل مرتجع على الدفعة دي. المبلغ موجب وبقرشين بالكتير، ومجموع المرتجعات على الدفعة ميزيدش عن مبلغها أبداً (لو زاد: 409).
- `GET /Payments/:Id/Refunds` يرجّع `{ Items, RefundedAmount, RefundableAmount }`، والمبالغ نصوص بقرشين زي باقي السيستم.
- لما كل الدفعات اللي على الطلب ترجع بالكامل، الطلب يبقى حالته `Refunded`. لو لسه فيه أي فلوس مارجعتش يفضل زي ما هو.
- الدفعة بتاعة شركة تانية كأنها مش موجودة (404).

ركّز إن الحسابات تطلع مظبوطة بالقرش، والمحاسب ممكن يضغط على الزرار كذا مرة ورا بعض بسرعة.

نفّذ. ماتسألنيش، افترض الافتراضات المنطقية واذكرها في الآخر.
