---
description: An implementation job run through kit-orchestrate on a real small codebase with a hidden race. Measures whether a coordinated team beats one plain session on correctness, tests and an honest closing report.
tags: [orchestration, team]
max_turns: 60
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Write, Edit, Agent, Skill, "Bash(node *)", "Bash(npm *)", "Bash(git *)"]
---
نفّذ بالفريق (kit-orchestrate) في مشروع الكوبونات ده: 1) `createCoupon` لازم ترفض النسبة خارج 1 إلى 100، والمبلغ الثابت اللي مش أكبر من صفر، وتاريخ الانتهاء اللي فات. 2) `applyCoupon` لازم ترفض الكوبون المنتهي، والإجمالي بعد الخصم ماينزلش تحت صفر. 3) `redeem` ماينفعش يعدّي حد الاستخدام حتى لو 20 طلب وصلوا في نفس اللحظة. ضيف اختبارات للتلاتة وشغّلها.
