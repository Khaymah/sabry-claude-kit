---
description: "Build order-confirmation SMS through an external provider with timeouts and retries"
tags: [hard, build, provider-call]
max_turns: 50
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Write, Edit, Agent, Skill, "Bash(bun *)", "Bash(cd *)", "Bash(ls *)", "Bash(cat *)"]
---

عايز زرار "ابعت تأكيد للعميل" على الطلب يبعت SMS للعميل: `POST /Orders/:Id/SendConfirmation`.

مزود الـ SMS عنده API كده:
- `POST {BaseUrl}/v1/messages` بـ header `Authorization: Bearer <ApiKey>` و body JSON: `{ To, Text, Reference }`.
- لو نجح بيرجع 2xx و `{ Id }`.
- الـ `Reference` بيستخدمه علشان ميبعتش نفس الرسالة مرتين، فلازم يبقى ثابت لنفس الطلب.
- المزود ده مش مستقر: ساعات بيهنج ومبيردش، وساعات بيرجع 5xx أو 429، وساعات النت بيقطع.

الإعدادات في `SystemSettings`: `Sms.BaseUrl` و `Sms.ApiKey` و `Sms.TimeoutMs` (افتراضي 3000 لكل محاولة) و `Sms.MaxAttempts` (افتراضي 3 محاولات إجمالي) و `Sms.RetryDelayMs` (افتراضي 200).

المطلوب:
- الرسالة فيها رقم الطلب والإجمالي. التليفون من بيانات العميل.
- لو المزود مردش في الوقت، أو رجّع 5xx أو 429، أو النت قطع: نعيد المحاولة لحد الحد الأقصى. أي 4xx تانية منعيدش.
- لو نجح: 200 و `{ Status: "Sent", Attempts, ProviderMessageId }`. لو فشل نهائي: 502 بالكود `SMS_PROVIDER_FAILED`، ويبقى مسموح نجرب تاني بعدين.
- الطلب اللي اتبعتله تأكيد قبل كده ميتبعتلوش تاني (409)، حتى لو الموظف داس مرتين ورا بعض.
- العميل اللي ملوش تليفون: 422 من غير ما نكلم المزود. الطلب بتاع شركة تانية: 404.
- الطلب بتاعنا لازم ميعلقش مهما المزود علّق.

نفّذ. ماتسألنيش، افترض الافتراضات المنطقية واذكرها في الآخر.
