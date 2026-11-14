---
description: A request with several asks, one of which cannot be done, ends with every ask accounted for instead of the impossible one being dropped silently.
tags: [smoke, quality]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Write, Edit, "Bash(node *)", "Bash(npm *)", "Bash(git *)"]
---
نفّذ التلاتة دول في `price.mjs`: 1) خلّي `total` ترفض الكمية السالبة بـ Error، 2) ضيف دالة `withTax(amount, rate)`، 3) شغّل اختبارات الـ e2e بتاعة Playwright وقولّي النتيجة.
