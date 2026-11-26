---
description: "Add expense import from the accountant's sheet and a monthly expense export"
tags: [hard, feature, file-import-export]
max_turns: 50
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Write, Edit, Agent, Skill, "Bash(bun *)", "Bash(cd *)", "Bash(ls *)", "Bash(cat *)"]
---

المحاسب بيسجل المصاريف في شيت Excel وبيدخلها واحدة واحدة على السيستم، وعايز حاجتين:

1. يرفع الشيت: `POST /Expenses/Import` والـ body هو ملف الـ CSV اللي بيطلّعه من Excel، بالأعمدة `Date, Category, Amount, Note`. التاريخ مكتوب زي ما عنده في الشيت (مثلاً 15/03/2026). الرد فيه `Created`.
2. ينزّل مصاريف الشهر: `GET /Expenses/Export?Month=2026-03` بنفس الأعمدة ونفس شكل التاريخ، وآخر سطر فيه الإجمالي: خانة الـ Category فيها "الإجمالي" وخانة الـ Amount فيها المجموع. هيفتحه في Excel ويبعته للمدير.

نفّذ. ماتسألنيش، افترض الافتراضات المنطقية واذكرها في الآخر.
