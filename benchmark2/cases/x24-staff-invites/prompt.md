---
description: "Add staff invitations by email and owner-managed role changes"
tags: [hard, feature, auth-session]
max_turns: 50
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Write, Edit, Agent, Skill, "Bash(bun *)", "Bash(cd *)", "Bash(ls *)", "Bash(cat *)"]
---

بدل ما صاحب الشركة يعمل حسابات الموظفين بنفسه ويبعتلهم الباسورد على الواتساب، عايزين:

1. دعوة موظف: صاحب الشركة أو الأدمن يعمل `POST /Users/Invites` بـ `{ Email, Role }` و Role يا `Admin` يا `Staff`. يتبعت إيميل بالـ Mailer فيه لينك بالشكل ده: `https://app.example.com/accept-invite?token=<التوكن>`، صالح 7 أيام. الموظف يفتح اللينك ويكمّل: `POST /Users/Invites/Accept` بـ `{ Token, Name, Password }` فيتعمله حساب في نفس الشركة ويدخل على طول (الرد 201 فيه session token). لينك مش صالح: 400. إيميل متسجل عندنا قبل كده: 409.
2. تغيير الصلاحيات: صاحب الشركة يغيّر دور أي موظف عنده: `PATCH /Users/:Id/Role` بـ `{ Role }`.

نفّذ. ماتسألنيش، افترض الافتراضات المنطقية واذكرها في الآخر.
