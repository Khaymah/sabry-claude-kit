---
description: "Build a per-customer sales report that stays fast at 100x data"
tags: [hard, build, performance]
max_turns: 50
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Write, Edit, Agent, Skill, "Bash(bun *)", "Bash(cd *)", "Bash(ls *)", "Bash(cat *)"]
---

محتاج تقرير العملا لصاحب الشركة: `GET /Reports/Customers?Page=&PageSize=` (نفس قواعد الـ paging اللي عندنا في باقي القوايم).

كل سطر فيه: `CustomerId` و `Name` و `OrdersCount` (عدد الطلبات من غير الملغية) و `TotalSpent` (مجموع إجمالي الطلبات المدفوعة بس، نص بقرشين) و `LastOrderAt` (تاريخ آخر طلب مش ملغي، أو null لو مفيش).

الترتيب: الأكتر صرفاً الأول، ولو اتساووا الأقدم Id الأول. والعملا اللي ملهمش طلبات يظهروا برضه (بـ 0). الرد: `{ Items, Page, PageSize, Total }` و Total هو عدد العملا.

خد بالك: فيه شركات عندها آلاف العملا وعشرات الآلاف من الطلبات، والتقرير ده هيتفتح كل يوم الصبح، فلازم يبقى سريع ومايتقلش لما الداتا تكبر. ولما حد يقلّب الصفحات كل عميل يظهر مرة واحدة بس.

نفّذ. ماتسألنيش، افترض الافتراضات المنطقية واذكرها في الآخر.
