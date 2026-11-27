---
description: "Add supplier payments and a supplier account statement"
tags: [hard, feature, tenant-isolation]
max_turns: 50
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Write, Edit, Agent, Skill, "Bash(bun *)", "Bash(cd *)", "Bash(ls *)", "Bash(cat *)"]
---

المحاسب بيمسك حسابات الموردين على ورق، وعايز ينقلها على السيستم:

1. تسجيل دفعة لمورد: `POST /Suppliers/:Id/Payments` بـ `{ Amount, Method, Note? }` و Method يا `Cash` يا `BankTransfer`.
2. كشف حساب المورد: `GET /Suppliers/:Id/Statement` يرجّع `{ Supplier: { Id, Name }, TotalPurchases, TotalPaid, Balance, Entries }`. المشتريات هي أوامر الشراء اللي اتستلمت بس (تاريخها تاريخ الاستلام)، و Balance = المشتريات − المدفوع. الـ Entries فيها كل حركة `{ Type: "Purchase" | "Payment", Id, Amount, Date }` مترتبة بالتاريخ.

نفّذ. ماتسألنيش، افترض الافتراضات المنطقية واذكرها في الآخر.
