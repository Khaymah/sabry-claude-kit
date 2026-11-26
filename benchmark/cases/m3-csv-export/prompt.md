---
description: "Medium build: export all orders to CSV for Excel, Arabic names, large volume."
tags: [medium, build, files]
max_turns: 35
timeout_seconds: 700
allowed_tools: [Read, Glob, Grep, Write, Edit, Agent, Skill, "Bash(node *)"]
---
نفّذ `exportOrdersCsv(write)` في `src/export.mjs`: بيصدّر كل الطلبات (ممكن توصل لمليون طلب) لملف CSV الأدمن بيفتحه في Excel. أسماء العملاء عربي. `write(chunk)` بتكتب جزء من الملف. استخدم `query` من `src/db.mjs`. ضيف اختبارات وشغّل `node --test`. ماتسألنيش، افترض الافتراضات المنطقية واذكرها.
