---
description: A multi-area implementation job (authorization, validation, concurrency, pagination, money, XSS, tests, docs) across nine files, run through kit-orchestrate. Large enough that a team is warranted; correctness is judged by a hidden test outside the suite.
tags: [team]
max_turns: 150
timeout_seconds: 1800
allowed_tools: [Read, Glob, Grep, Write, Edit, Agent, Skill, "Bash(node *)", "Bash(npm *)", "Bash(git *)"]
---
نفّذ بالفريق (kit-orchestrate) على خدمة الطلبات دي. العقد في `docs/contract.md` ولازم يفضل زي ما هو إلا في اللي مكتوب هنا:

1. `GET /orders/:id`: العميل مايشوفش طلب عميل تاني (يرجع 404)، والأدمن يشوف أي طلب.
2. `POST /orders`: تحقق من المدخلات ويرجع 400 مع `{ error, fields }` لو `items` فاضية أو مش array، أو `quantity` مش عدد صحيح من 1 إلى 100، أو `productId` مش موجود. ومفيش مخزون يتحجز لطلب مرفوض.
3. المخزون ماينزلش تحت صفر حتى مع 20 طلب في نفس اللحظة على نفس المنتج، والطلب اللي مالوش مخزون يرجع 409.
4. `GET /orders`: `page` بيبدأ من 1، و`pageSize` الافتراضي 10 والأقصى 50، والأدمن يشوف طلبات الكل.
5. الفلوس أعداد صحيحة بالقروش: المنتج يرجّع `priceCents` والطلب يرجّع `totalCents` (من غير `price` ولا `total`).
6. `renderOrders` في `public/app.js` لازم تعمل escape لملاحظة العميل وتعرض الإجمالي بصيغة `12.34`.
7. اختبارات لكل بند، وتحديث `docs/contract.md` بأكواد الأخطاء الجديدة. شغّل الاختبارات.
