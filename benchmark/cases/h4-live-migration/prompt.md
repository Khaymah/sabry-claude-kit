---
description: "Hard design: change a column on a 20M-row live table without downtime."
tags: [hard, design, data]
max_turns: 20
allowed_tools: [Read, Glob, Grep, Agent, Skill]
---
عندنا جدول `Orders` فيه 20 مليون صف على PostgreSQL والموقع شغال 24 ساعة. عايزين نغيّر عمود `Total` من `numeric` بالجنيه لـ `TotalMinor bigint` بالقروش، وكمان نضيف index على `(CustomerId, CreatedAt)`. الـ backend بيتعمله deploy على أكتر من instance. اكتبلي خطة التنفيذ خطوة بخطوة. ماتسألنيش، افترض الافتراضات المنطقية واذكرها.
