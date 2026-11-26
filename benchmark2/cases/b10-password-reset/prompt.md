---
description: "Build forgot-password by email link"
tags: [hard, build, auth-session]
max_turns: 50
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Write, Edit, Agent, Skill, "Bash(bun *)", "Bash(cd *)", "Bash(ls *)", "Bash(cat *)"]
---

الناس بتنسى الباسورد وبتكلمنا على الواتساب. عايز "نسيت كلمة السر":
- `POST /Auth/PasswordReset/Request` بـ `{ Email }`: يبعت إيميل بالـ Mailer الموجود فيه لينك بالشكل ده: `https://app.example.com/reset-password?token=<التوكن>`. اللينك صالح 30 دقيقة.
- `POST /Auth/PasswordReset/Confirm` بـ `{ Token, NewPassword }`: يغيّر الباسورد (نفس شروط الباسورد عندنا).
- لينك مش صالح: 400.

نفّذ. ماتسألنيش، افترض الافتراضات المنطقية واذكرها في الآخر.
