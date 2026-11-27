---
description: "Easy build: cart total with VAT and a percentage coupon, prices given as decimal strings."
tags: [easy, build, money]
max_turns: 30
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Write, Edit, Agent, Skill, "Bash(node *)"]
---
نفّذ `calculateTotal(items, { couponPercent })` في `src/cart.mjs`. كل item فيه `price` كـ string بالجنيه زي `"19.99"` و `quantity`. فيه ضريبة 14% على الإجمالي بعد الخصم، والكوبون نسبة مئوية اختيارية. رجّع subtotal و discount و tax و total. ضيف اختبارات في `test/cart.test.mjs` وشغّل `node --test`. ماتسألنيش، افترض الافتراضات المنطقية واذكرها في الآخر.
