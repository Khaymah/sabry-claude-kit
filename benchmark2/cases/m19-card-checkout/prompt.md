---
description: "Add card checkout through the payment gateway"
tags: [hard, feature, provider-call]
max_turns: 50
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Write, Edit, Agent, Skill, "Bash(bun *)", "Bash(cd *)", "Bash(ls *)", "Bash(cat *)"]
---

عايزين العميل يدفع بالكارت: `POST /Orders/:Id/Checkout` بـ `{ CardToken }`، ونخصم المتبقي على الطلب.

البوابة: `POST {BaseUrl}/v1/charges` بـ `Authorization: Bearer <ApiKey>` و `Idempotency-Key`، و body `{ Amount, Currency: "EGP", CardToken, Reference }` والـ Amount بالقروش كرقم صحيح. نجاح: 2xx و `{ Id, Status: "succeeded" }`. كارت مرفوض: 402. البوابة بتعتبر نفس الـ `Idempotency-Key` بنفس البيانات نفس العملية. الإعدادات: `Gateway.BaseUrl` و `Gateway.ApiKey` و `Gateway.TimeoutMs` و `Gateway.MaxAttempts` و `Gateway.RetryDelayMs`.

- نجح: نسجل دفعة `Card` ورقم العملية في `ProviderRef`، والطلب `Paid`، و 200.
- مرفوض: 402 `PAYMENT_DECLINED`. البوابة مردتش: 504. طلب مدفوع: 409.

نفّذ. ماتسألنيش، افترض الافتراضات المنطقية واذكرها في الآخر.
