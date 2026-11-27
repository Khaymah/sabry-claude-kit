---
description: "Hard fix: a SaaS customer sees another company's project."
tags: [hard, fix, security]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Write, Edit, Agent, Skill, "Bash(node *)"]
---
عميل في الـ SaaS بتاعنا بلّغ إنه فتح لينك مشروع ولقى مشروع شركة تانية. الكود في `src/projects.mjs`، و `user` فيه `id` و `tenantId`. صلّح المشكلة في كل الدوال، وضيف اختبارات، وشغّل `node --test`. نفّذ. ماتسألنيش، افترض الافتراضات المنطقية واذكرها.
