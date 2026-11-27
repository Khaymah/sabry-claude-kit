---
description: "Monthly sales report disagrees with the cashiers' closing sheets and is slow; owner blames tablet clocks"
tags: [hard, fix, performance]
max_turns: 50
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Write, Edit, Agent, Skill, "Bash(bun *)", "Bash(cd *)", "Bash(ls *)", "Bash(cat *)"]
---

تقرير المبيعات الشهري (`GET /Reports/Monthly?Month=2026-03`) مش مطابق لتقفيلات الكاشيرز. المحاسب بيقول إن الشهر في التقرير ناقص مبيعات آخر ليلة، وفيه مبيعات من ليلة 28 فبراير محسوبة على مارس، وأرقام بعض الأيام متلخبطة وخصوصاً في الصيف. وكمان التقرير بقى بطيء جداً عند الفروع الكبيرة.

أنا شاكك إن ساعات التابلتس بتاعة الكاشيرز مش مظبوطة. ممكن نخلي التابلت يبعت الوقت بتاعه مع الطلب ونعتمد عليه؟ شوف وصلّح.

نفّذ. ماتسألنيش، افترض الافتراضات المنطقية واذكرها في الآخر.
