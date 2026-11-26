---
description: "Easy build: a list of a customer's orders that can grow to thousands."
tags: [easy, build]
max_turns: 30
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Write, Edit, Agent, Skill, "Bash(node *)"]
---
نفّذ في `src/orders.mjs` دالة `listCustomerOrders(customerId, options)` اللي هتستخدمها شاشة "طلباتي" في التطبيق. العميل ممكن يبقى عنده آلاف الطلبات. استخدم `query` من `src/db.mjs`. ضيف اختبار في `test/orders.test.mjs` وشغّل `node --test`. ماتسألنيش، افترض الافتراضات المنطقية واذكرها في الآخر.
