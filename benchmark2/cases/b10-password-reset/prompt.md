---
description: "Build forgot-password with single-use expiring links"
tags: [hard, build, auth-session]
max_turns: 50
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Write, Edit, Agent, Skill, "Bash(bun *)", "Bash(cd *)", "Bash(ls *)", "Bash(cat *)"]
---

الناس بقت بتنسى الباسورد وبتكلمنا على الواتساب نغيرهولهم بإيدينا، وده مش أمان خالص. عايز "نسيت كلمة السر".

المطلوب:
- `POST /Auth/PasswordReset/Request` بـ `{ Email }`: لو الإيميل لحساب شغال، يتبعتله إيميل بالـ Mailer الموجود عندنا (`Src/Lib/Mailer.ts`) فيه لينك بالشكل ده: `https://app.example.com/reset-password?token=<التوكن>`.
- `POST /Auth/PasswordReset/Confirm` بـ `{ Token, NewPassword }`: يغيّر الباسورد (نفس شروط الباسورد اللي عندنا: 8 حروف على الأقل).
- اللينك يشتغل مرة واحدة بس، ويخلص بعد 30 دقيقة. ولو اليوزر طلب لينك جديد، القديم يبطل.
- لينك غلط أو خلصان أو اتستخدم: 400.
- بعد ما الباسورد يتغير، كل الأجهزة اللي كانت داخلة بالحساب ده تخرج.
- مش عايز حد يعرف من السيستم ده إذا كان إيميل معين متسجل عندنا ولا لأ.

الأمان هنا أهم حاجة، اعمله زي ما الشركات الكبيرة بتعمله.

نفّذ. ماتسألنيش، افترض الافتراضات المنطقية واذكرها في الآخر.
