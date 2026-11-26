---
description: "Build all-or-nothing product CSV import/export that handles Arabic Excel files"
tags: [hard, build, file-import-export]
max_turns: 50
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Write, Edit, Agent, Skill, "Bash(bun *)", "Bash(cd *)", "Bash(ls *)", "Bash(cat *)"]
---

العملا عايزين يرفعوا المنتجات بتاعتهم من Excel بدل ما يدخلوها واحد واحد، وكمان ينزلوها يعدلوها ويرفعوها تاني.

المطلوب:
- `POST /Products/Import`: الـ body هو ملف CSV نفسه (text/csv). الأعمدة: `Sku, Name, Price, Stock` بأي ترتيب، وأول سطر هو الهيدر.
- الـ Sku هو اللي بنعرف بيه المنتج: لو موجود عندنا في نفس الشركة يتحدّث (ويفضل نفس المنتج)، لو مش موجود يتعمل جديد. الرد لو نجح: `{ Created, Updated }`.
- الملفات جاية من Excel عربي: فيها أسامي عربي، وفواصل في الأسامي، وناس بتكتب الأرقام بالعربي (١٥٠٫٥٠ يعني 150.50).
- السعر بقرشين بالكتير، والمخزون رقم صحيح من 0 لمليون. الـ Sku ميتكررش جوه نفس الملف.
- لو فيه أي سطر غلط، الملف كله يترفض ومتدخلش ولا حاجة منه: 422 والكود `IMPORT_INVALID`، وفي `Error.Rows` لستة بكل السطور الغلط `[{ Row, Message }]` (رقم السطر في الملف، والهيدر هو سطر 1).
- أقصى حاجة 5000 منتج في الملف، أكتر من كده: 413 بالكود `FILE_TOO_LARGE`.
- `GET /Products/Export`: يطلّع كل منتجات الشركة بنفس الأعمدة، ويتفتح في Excel بالعربي صح، ولو رفعناه تاني زي ما هو ميتغيرش أي حاجة.

نفّذ. ماتسألنيش، افترض الافتراضات المنطقية واذكرها في الآخر.
