---
description: "Add payment receipts showing their VAT share, and an order invoice view"
tags: [hard, feature, money]
max_turns: 50
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Write, Edit, Agent, Skill, "Bash(bun *)", "Bash(cd *)", "Bash(ls *)", "Bash(cat *)"]
---

مصلحة الضرايب طالبة إن كل إيصال دفع يبين قيمة الضريبة اللي جواه، وإحنا عندنا عملا كتير بيدفعوا على أقساط. عايز:

1. إيصال الدفعة: `GET /Payments/:Id/Receipt` يرجّع `{ PaymentId, OrderId, Amount, NetAmount, VatAmount }`. الضريبة اللي في الدفعة هي نصيبها من ضريبة الطلب بنسبة مبلغها لإجمالي الطلب، و NetAmount هو الباقي.
2. فاتورة الطلب: `GET /Orders/:Id/Invoice` يرجّع `{ OrderId, Subtotal, Discount, Tax, Total, Payments, Balance }`، و Payments فيها كل دفعة بالترتيب ومعاها `PaymentId, Amount, VatAmount, NetAmount`، و Balance المتبقي على الطلب.

نفّذ. ماتسألنيش، افترض الافتراضات المنطقية واذكرها في الآخر.
