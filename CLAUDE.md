# 🧠 sabry-kit Agent

> **إعدادات المالك الشخصية** (من `/sabry-kit:kit-setup`) بتتحقن فوق الملف ده وبتغلبه. هنا **قواعد الكيت بس**. كل ما هو سلوك افتراضي جيد في Claude Code — لا يُكتب هنا.
>
> القواعد اتقسّمت لملفات موضوعية في [`.claude/rules/`](rules/) — كلها **بتتحمّل أوتوماتيك كل جلسة**
> بنفس أولوية هذا الملف (مفيش داعي لأي `@import`). التقسيمة دي للتنظيم بس، مش بتغيّر أي قاعدة.

| الملف | الموضوع |
|---|---|
| [rules/communication.md](rules/communication.md) | لغة المالك (من الـ profile) · `AskUserQuestion` حصراً · لا تخمّن · عند التوقف اسأل |
| [rules/operating-mode.md](rules/operating-mode.md) | CTO + PM لا كود · الأدوار + شرط DevOps-SRE · Stack افتراضي · Session Startup |
| [rules/output-language.md](rules/output-language.md) | لغة المخرجات · 🚫 لا نسبة لـ AI في الـ git |
| [rules/comment-discipline.md](rules/comment-discipline.md) | الكود بلا كومنتات · JSDoc يُحذف · استثناء `IMPORTANT:` فقط · hook |
| [rules/subagents.md](rules/subagents.md) | الموديل من frontmatter الـ agent · متى أفوّض · قالب التكليف |
| [rules/code-tools.md](rules/code-tools.md) | أدوات فهم الكود (graph vs Grep) |
| [rules/completion-discipline.md](rules/completion-discipline.md) | typecheck + الاختبارات المتعلقة + lint قبل الانتهاء · Scope 3+ ملفات |
| [rules/framework-gotchas.md](rules/framework-gotchas.md) | Hono · Drizzle · TS · Fastify · Bun — *(path-scoped: ‎**/*.ts,tsx‎)* |
| [rules/architecture-decisions.md](rules/architecture-decisions.md) | Quality-Gate · ADR · متى يستحق |
| [rules/deal-economics.md](rules/deal-economics.md) | Freelancer-Trap |
| [rules/knowledge-and-plans.md](rules/knowledge-and-plans.md) | المعرفة المتراكمة · `Plan/Progress/` اليومي (Handoff) · الخطط في ملفات |
| [rules/project-storage.md](rules/project-storage.md) | ذاكرة المشروع والملفات المؤقتة جوه `.agents/` |

قواعد المشروع في `<project-root>/CLAUDE.md` (→ `@AGENTS.md`) — لا تكرّرها هنا.
