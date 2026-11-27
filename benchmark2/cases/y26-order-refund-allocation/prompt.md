---
description: "Add order-level refunds for orders paid in several payments"
tags: [hard, feature, money]
max_turns: 50
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Write, Edit, Agent, Skill, "Bash(bun *)", "Bash(cd *)", "Bash(ls *)", "Bash(cat *)"]
---

فيه طلبات العميل بيدفعها على كذا دفعة (كاش وكارت)، ولما يرجّع حاجة الكاشير مش عارف يرجّع من أنهي دفعة. عايز المرتجع يبقى على الطلب نفسه:
- `POST /Orders/:Id/Refunds` بـ `{ Amount, Reason? }`. المبلغ بيترجع من أحدث دفعة الأول، ولو مكفتش يكمّل من اللي قبلها. الرد فيه `Allocations: [{ PaymentId, Amount }]` يقول اترجع كام من كل دفعة، ومعاه `RefundedAmount` و `RefundableAmount`.
- مينفعش نرجّع أكتر من المدفوع (409).
- `GET /Orders/:Id/Refunds` يرجّع `{ Items, RefundedAmount, RefundableAmount }`.
- لما الطلب كله يرجع، حالته تبقى `Refunded`.

نفّذ. ماتسألنيش، افترض الافتراضات المنطقية واذكرها في الآخر.
