---
description: "Add loyalty points with redemption into the wallet, and make wallet payments actually use the wallet"
tags: [hard, feature, concurrency]
max_turns: 50
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Write, Edit, Agent, Skill, "Bash(bun *)", "Bash(cd *)", "Bash(ls *)", "Bash(cat *)"]
---

عايزين حاجتين للعملا الدايمين:

1. برنامج نقاط: العميل ياخد نقطة على كل 10 جنيه كاملين من إجمالي الطلب لما الطلب يتدفع بالكامل. `GET /Customers/:Id/Loyalty` يرجّع `{ Points, WalletBalance }`. والعميل يقدر يحوّل نقطه لرصيد في المحفظة: `POST /Customers/:Id/Loyalty/Redeem` بـ `{ Points }`، كل 100 نقطة بـ 10 جنيه، والتحويل بمضاعفات الـ 100 بس (غير كده 400). لو نقطه مش كفاية: 409.

2. الدفع من المحفظة: الكاشير بيختار `Wallet` كطريقة دفع في `POST /Payments` بس الرصيد مش بيتخصم أصلاً. خليه يتخصم من رصيد العميل، ولو الرصيد مش كفاية: 409 بالكود `INSUFFICIENT_BALANCE`.

الـ README فيه حاجات قديمة شوية، متعتمدش عليه أوي.

نفّذ. ماتسألنيش، افترض الافتراضات المنطقية واذكرها في الآخر.
