---
description: "Add card checkout through a flaky payment gateway without ever double-charging"
tags: [hard, feature, provider-call]
max_turns: 50
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Write, Edit, Agent, Skill, "Bash(bun *)", "Bash(cd *)", "Bash(ls *)", "Bash(cat *)"]
---

عايزين العميل يقدر يدفع الطلب بالكارت: `POST /Orders/:Id/Checkout` بـ `{ CardToken }`.

بوابة الدفع:
- `POST {BaseUrl}/v1/charges` بـ headers: `Authorization: Bearer <ApiKey>` و `Idempotency-Key: <مفتاح>`، و body JSON: `{ Amount, Currency: "EGP", CardToken, Reference }`. الـ Amount بالقروش كرقم صحيح (يعني 228.50 جنيه = 22850).
- نجاح: 2xx و `{ Id, Status: "succeeded" }`. الكارت مرفوض: 402.
- البوابة بتحترم الـ `Idempotency-Key`: لو نفس المفتاح اتبعت تاني بنفس البيانات بترجع نفس العملية من غير ما تخصم تاني، ولو بيانات مختلفة بترفض. 
- البوابة بطيئة ومش مستقرة: ساعات بترجع 5xx، وساعات بتخصم فعلاً من العميل بس الرد مبيوصلناش.

الإعدادات في `SystemSettings`: `Gateway.BaseUrl` و `Gateway.ApiKey` و `Gateway.TimeoutMs` (افتراضي 5000 لكل محاولة) و `Gateway.MaxAttempts` (افتراضي 3) و `Gateway.RetryDelayMs` (افتراضي 200).

المطلوب:
- نخصم المتبقي على الطلب بس (الإجمالي ناقص اللي اتدفع قبل كده). لو نجح: نسجل دفعة `Card` ومعاها رقم العملية في `ProviderRef`، والطلب يبقى `Paid`، ونرجع 200.
- 5xx أو مفيش رد في الوقت: نعيد المحاولة. لو خلصت المحاولات من غير رد: 504 والطلب يفضل Pending.
- الكارت المرفوض: 402 بالكود `PAYMENT_DECLINED` ومنعيدش، والعميل يقدر يجرب كارت تاني.
- أهم حاجة: العميل ميتخصمش منه مرتين أبداً، لا لو داس على الزرار مرتين، ولا لو البوابة خصمت ومردتش وهو رجع داس تاني.
- طلب مدفوع: 409. طلب شركة تانية: 404. وفي الحالتين منكلمش البوابة.

نفّذ. ماتسألنيش، افترض الافتراضات المنطقية واذكرها في الآخر.
