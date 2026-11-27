---
description: "Hard design: observability for a production app on a VPS after an unnoticed outage."
tags: [hard, design, observability]
max_turns: 20
allowed_tools: [Read, Glob, Grep, Agent, Skill]
---
عندنا تطبيق Bun + Hono + PostgreSQL على VPS واحد ب Nginx و PM2، وفيه عملاء بيدفعوا. امبارح الموقع وقع 3 ساعات وعرفنا من عميل، والـ backup طلع واقف من أسبوعين ومحدش عرف. حطلي خطة مراقبة كاملة نقدر ننفذها الأسبوع ده. ماتسألنيش، افترض الافتراضات المنطقية واذكرها.
