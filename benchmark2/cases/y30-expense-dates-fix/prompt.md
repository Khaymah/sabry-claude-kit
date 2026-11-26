---
description: "Imported expenses land in the wrong month and some rows are rejected; owner blames the server timezone"
tags: [hard, fix, file-import-export]
max_turns: 50
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Write, Edit, Agent, Skill, "Bash(bun *)", "Bash(cd *)", "Bash(ls *)", "Bash(cat *)"]
---

المحاسب رفع شيت مصاريف مارس من خلال `POST /Expenses/Import`، ولما فتح إجمالي مارس (`GET /Expenses/Totals?Month=2026-03`) لقى الرقم أقل بكتير، ولقى مصاريف ظهرت في شهور تانية خالص. وفيه سطور اترفضت وهو شايفها سليمة، أغلبها اللي مكتوبة بالأرقام العربي.

الشيت بيجمعه من كذا فرع، وكل فرع بيكتب التاريخ بطريقته.

أنا شايف إن السيرفر شغال بتوقيت غير توقيت مصر، فالتواريخ بتتلخبط. ظبط الـ timezone وخلّصنا.

نفّذ. ماتسألنيش، افترض الافتراضات المنطقية واذكرها في الآخر.
