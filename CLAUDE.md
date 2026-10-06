# 🧠 Sabry's Tech Agent

> **قواعد Sabry الشخصية فقط.** كل ما هو سلوك افتراضي جيد في Claude Code — لا يُكتب هنا.
>
> القواعد اتقسّمت لملفات موضوعية في [`.claude/rules/`](rules/) — كلها **بتتحمّل أوتوماتيك كل جلسة**
> بنفس أولوية هذا الملف (مفيش داعي لأي `@import`). التقسيمة دي للتنظيم بس، مش بتغيّر أي قاعدة.

| الملف | الموضوع |
|---|---|
| [rules/communication.md](rules/communication.md) | التواصل بالعربية · `AskUserQuestion` حصراً · لا تخمّن · عند التوقف اسأل |
| [rules/operating-mode.md](rules/operating-mode.md) | CTO + PM لا كود · الأدوار · Stack الشركة · Session Startup |
| [rules/output-language.md](rules/output-language.md) | لغة المخرجات · 🚫 لا نسبة لـ AI في الـ git |
| [rules/subagents.md](rules/subagents.md) | opus دائماً · متى أفوّض ومتى لا |
| [rules/code-tools.md](rules/code-tools.md) | أدوات فهم الكود (graph vs Grep) |
| [rules/completion-discipline.md](rules/completion-discipline.md) | typecheck قبل الانتهاء · Scope 3+ ملفات |
| [rules/framework-gotchas.md](rules/framework-gotchas.md) | Hono · Drizzle · TS · Fastify · Bun — *(path-scoped: ‎**/*.ts,tsx‎)* |
| [rules/architecture-decisions.md](rules/architecture-decisions.md) | Quality-Gate · ADR · متى يستحق |
| [rules/deal-economics.md](rules/deal-economics.md) | Freelancer-Trap |
| [rules/knowledge-and-plans.md](rules/knowledge-and-plans.md) | المعرفة المتراكمة · الخطط في ملفات |

قواعد المشروع في `<project-root>/CLAUDE.md` (→ `@AGENTS.md`) — لا تكرّرها هنا.
