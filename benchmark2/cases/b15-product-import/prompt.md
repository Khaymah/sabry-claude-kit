---
description: "Build product CSV import and export"
tags: [hard, build, file-import-export]
max_turns: 50
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Write, Edit, Agent, Skill, "Bash(bun *)", "Bash(cd *)", "Bash(ls *)", "Bash(cat *)"]
---

العملا عايزين يرفعوا المنتجات من Excel وينزلوها يعدلوها ويرفعوها تاني.
- `POST /Products/Import`: الـ body هو ملف الـ CSV. الأعمدة `Sku, Name, Price, Stock` بأي ترتيب. المنتج اللي الـ Sku بتاعه موجود يتحدّث، غير كده يتعمل جديد. الرد `{ Created, Updated }`.
- الشيتات جاية من محلات، الأسامي عربي والأرقام ساعات مكتوبة بالعربي.
- لو فيه أي سطر غلط مش عايز حاجة من الملف تدخل: 422 بالكود `IMPORT_INVALID` وفي `Error.Rows` لستة `[{ Row, Message }]` (الهيدر سطر 1).
- أقصى حاجة 5000 منتج في الملف، أكتر: 413 `FILE_TOO_LARGE`.
- `GET /Products/Export` بنفس الأعمدة.

نفّذ. ماتسألنيش، افترض الافتراضات المنطقية واذكرها في الآخر.
