---
description: "Medium build: a payment provider webhook that marks orders paid."
tags: [medium, build, payments]
max_turns: 35
timeout_seconds: 700
allowed_tools: [Read, Glob, Grep, Write, Edit, Agent, Skill, "Bash(node *)"]
---
بوابة الدفع بتبعت webhook لما الدفع ينجح: الـ body JSON فيه `eventId` و `orderId` و `amountCents` و `currency`، ومعاه header اسمه `x-signature` = HMAC-SHA256 hex للـ raw body بالـ secret اللي في `src/config.mjs`. نفّذ `handleWebhook(rawBody, headers)` في `src/webhook.mjs` باستخدام `src/store.mjs` عشان يعلّم الطلب إنه مدفوع، ورجّع `{ status, body }`. ضيف اختبارات وشغّل `node --test`. ماتسألنيش، افترض الافتراضات المنطقية واذكرها.
