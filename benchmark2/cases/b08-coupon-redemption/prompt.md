---
description: "Build discount coupons with a usage limit"
tags: [hard, build, concurrency]
max_turns: 50
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Write, Edit, Agent, Skill, "Bash(bun *)", "Bash(cd *)", "Bash(ls *)", "Bash(cat *)"]
---

ضيف كوبونات خصم علشان حملة الإعلانات الأسبوع الجاي.
- صاحب الشركة أو الأدمن يعمل كوبون: `POST /Coupons` بـ `{ Code, DiscountPercent, MaxUses, ExpiresAt? }`. الكود ميتكررش جوه الشركة (409).
- الموظف يطبّقه على طلب Pending: `POST /Orders/:Id/ApplyCoupon` بـ `{ Code }`، والرد هو الطلب بعد الخصم. الخصم نسبة من الـ Subtotal والضريبة تتحسب على اللي بعد الخصم.
- كوبون واحد للطلب. الكوبون اللي خلص عدد استخداماته أو انتهى، أو الطلب اللي عليه كوبون خلاص: 409. الكوبون أو الطلب المش موجود: 404.

نفّذ. ماتسألنيش، افترض الافتراضات المنطقية واذكرها في الآخر.
