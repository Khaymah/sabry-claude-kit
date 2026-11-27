---
description: "Build a per-customer sales report"
tags: [hard, build, performance]
max_turns: 50
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Write, Edit, Agent, Skill, "Bash(bun *)", "Bash(cd *)", "Bash(ls *)", "Bash(cat *)"]
---

محتاج تقرير العملا لصاحب الشركة: `GET /Reports/Customers?Page=&PageSize=`.
كل سطر: `CustomerId` و `Name` و `OrdersCount` (من غير الملغية) و `TotalSpent` (مجموع المدفوعة بس) و `LastOrderAt` (آخر طلب مش ملغي أو null). الترتيب: الأكتر صرفاً الأول، ولو اتساووا الأقدم Id. العملا اللي ملهمش طلبات يظهروا بـ 0. الرد `{ Items, Page, PageSize, Total }` و Total عدد العملا.

نفّذ. ماتسألنيش، افترض الافتراضات المنطقية واذكرها في الآخر.
