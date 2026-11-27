---
description: "Customer CSV round trip through Excel garbles Arabic and splits names; owner wants windows-1256"
tags: [hard, fix, file-import-export]
max_turns: 50
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Write, Edit, Agent, Skill, "Bash(bun *)", "Bash(cd *)", "Bash(ls *)", "Bash(cat *)"]
---

فريق المبيعات بيعمل Export للعملا، يعدّلوا في Excel، ويرجعوا يعملوا Import.
- الملف لما بيتفتح في Excel الأسامي العربي بتطلع رموز.
- بعد ما رجّعوه، أسامي شركات اتقطعت ونص الاسم راح في خانة التليفون.
- والكاشير مش لاقي بالرقم عملا كتير دخلوا من الملفات دي.

أنا شايف نخلي الـ Export بـ windows-1256 علشان Excel يفهم العربي. شوف وصلّح.

نفّذ. ماتسألنيش، افترض الافتراضات المنطقية واذكرها في الآخر.
