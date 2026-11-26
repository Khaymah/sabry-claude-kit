---
description: "Build an order-confirmation SMS button through an SMS provider"
tags: [hard, build, provider-call]
max_turns: 50
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Write, Edit, Agent, Skill, "Bash(bun *)", "Bash(cd *)", "Bash(ls *)", "Bash(cat *)"]
---

عايز زرار "ابعت تأكيد للعميل" على الطلب: `POST /Orders/:Id/SendConfirmation` يبعت SMS للعميل فيه رقم الطلب والإجمالي.

مزود الـ SMS: `POST {BaseUrl}/v1/messages` بـ `Authorization: Bearer <ApiKey>` و body `{ To, Text, Reference }`، ولو نجح بيرجع 2xx و `{ Id }`. الإعدادات في `SystemSettings`: `Sms.BaseUrl` و `Sms.ApiKey` و `Sms.TimeoutMs` و `Sms.MaxAttempts` و `Sms.RetryDelayMs`.

- نجح: 200 و `{ Status: "Sent", Attempts, ProviderMessageId }`. فشل: 502 بالكود `SMS_PROVIDER_FAILED`.
- الطلب ياخد تأكيد واحد بس (409 لو اتبعت قبل كده). العميل اللي ملوش رقم: 422.

نفّذ. ماتسألنيش، افترض الافتراضات المنطقية واذكرها في الآخر.
