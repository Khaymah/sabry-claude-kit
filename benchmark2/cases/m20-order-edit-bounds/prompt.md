---
description: "Add editing of pending order lines"
tags: [hard, feature, input-validation]
max_turns: 50
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Write, Edit, Agent, Skill, "Bash(bun *)", "Bash(cd *)", "Bash(ls *)", "Bash(cat *)"]
---

الكول سنتر محتاج يعدّل الطلب قبل الدفع: `PATCH /Orders/:Id/Items` بـ `{ Items: [{ ProductId, Quantity }], Note? }`، والسطور دي بتحل محل سطور الطلب.
- الطلب Pending ومفيش عليه دفعات، غير كده 409.
- نفس قواعد السطور اللي في إنشاء الطلب، والملاحظة لحد 500 حرف.
- المخزون يتظبط حسب التعديل (`OUT_OF_STOCK` لو مش كفاية)، والإجماليات تتحسب من جديد بسعر المنتج الحالي.
- الطلب ميعديش مليون جنيه: 422 `ORDER_TOO_LARGE`.

نفّذ. ماتسألنيش، افترض الافتراضات المنطقية واذكرها في الآخر.
