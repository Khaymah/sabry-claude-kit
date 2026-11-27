---
description: "Fired staff still in, logout acting oddly, password change not helping; owner blames token length"
tags: [hard, fix, auth-session]
max_turns: 50
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Write, Edit, Agent, Skill, "Bash(bun *)", "Bash(cd *)", "Bash(ls *)", "Bash(cat *)"]
---

عندي كذا شكوى في الدخول:
- موظف مشّيناه وعملناله Deactivate، لسه بيفتح السيستم من موبايله.
- موظفة بتقول إنها بتعمل Logout وترجع تلاقي نفسها لسه داخلة، وفي نفس اليوم صاحب الشركة اشتكى إن التابلت بتاعه خرج لوحده.
- عميل حس إن حد عرف الباسورد بتاعه فغيّره، والشخص التاني لسه داخل بحسابه.

أنا شايف إن الـ token قصير وسهل يتخمن، طوّله أو غيّر طريقة توليده.

نفّذ. ماتسألنيش، افترض الافتراضات المنطقية واذكرها في الآخر.
