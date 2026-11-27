---
description: "Add card refunds through the payment gateway"
tags: [hard, feature, provider-call]
max_turns: 50
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Write, Edit, Agent, Skill, "Bash(bun *)", "Bash(cd *)", "Bash(ls *)", "Bash(cat *)"]
---

المرتجعات على دفعات الكارت لسه بنعملها بإيدينا من لوحة بوابة الدفع. عايز زرار في السيستم: `POST /Payments/:Id/GatewayRefund` بـ `{ Amount }`.

البوابة: `POST {BaseUrl}/v1/refunds` بـ `Authorization: Bearer <ApiKey>` و `Idempotency-Key`، و body `{ ChargeId, Amount }`. الـ ChargeId هو الـ `ProviderRef` اللي على الدفعة، والـ Amount بالقروش رقم صحيح. نجاح: 2xx و `{ Id }`. البوابة بتعتبر نفس الـ `Idempotency-Key` بنفس البيانات نفس العملية، ولو نفس المفتاح ببيانات مختلفة بترفض. الإعدادات: `Gateway.BaseUrl` و `Gateway.ApiKey` و `Gateway.TimeoutMs` و `Gateway.MaxAttempts` و `Gateway.RetryDelayMs`.

- نجح: 201. البوابة مردتش: 504.
- مجموع المرتجعات ميعديش مبلغ الدفعة (409). الدفعة اللي مش كارت: 409.

نفّذ. ماتسألنيش، افترض الافتراضات المنطقية واذكرها في الآخر.
