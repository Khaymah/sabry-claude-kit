---
name: kit-setup
description: First-time sabry-kit setup. Asks a few questions (name, language, reply style, work mode, stack, cost vs quality, enforced rules) and saves a top-priority profile injected every session. Use on `/sabry-kit:kit-setup` or `/kit-setup`, when the session says setup isn't done, or when the user says "غيّر إعداداتي" / "إعداد الكيت" / "change my preferences" / "reset setup".
---

# ⚙️ sabry-kit setup

Reply in the owner's language (profile; default Egyptian Arabic).

Goal: a small profile injected at the start of every session that overrides any other rule. **Two minutes max**: 3 rounds, each one `AskUserQuestion` with at most 4 questions.

## 0. Current state

Kit dir = two levels above this skill's dir (the base directory shown when the skill loaded). Run:

```bash
python3 "<kit>/hooks/kit_profile.py" show
```

- `exists: true` -> this is an edit, not a fresh setup: show current settings in a small table and ask only about what they want to change.
- An old `PersonalContext.md` (in `~/.claude/` or the kit dir) holding real personal context, not a template? Offer importing it as the first option in round 3.
- Suggest the name from `git config user.name` if present.

## 1. Round 1: communication

`AskUserQuestion` with these (questions/options below are the default Arabic wording; if the user writes English, ask in English):

| Question | Options (recommended first) | Key |
|---|---|---|
| أناديك بإيه؟ | `<git name>` · من غير اسم | `name` (free text via "Other") |
| لغة المحادثة والمستندات؟ | العربية بالمصري · العربية الفصحى · English | `language`: `ar-eg` · `ar` · `en` |
| أسلوب الرد؟ | مختصر ومباشر · متوسط · مفصّل | `verbosity`: `concise` · `balanced` · `detailed` |
| دورك؟ | Solo / freelancer · مطوّر في فريق · Tech lead / CTO · مش تقني | `role` (text) |

## 2. Round 2: way of working

| Question | Options | Key |
|---|---|---|
| وضع العمل الافتراضي؟ | CTO + PM: خطط وراجع ولا كود إلا بإذن · تنفيذ مباشر | `mode`: `cto-pm` · `direct` |
| لما الطلب غامض؟ | اسألني بخيارات · افترض وكمّل واكتب الافتراضات | `questions`: `ask` · `assume` |
| التكلفة مقابل الجودة؟ | متوازن · اقتصادي · أقصى جودة | `cost_profile`: `balanced` · `economy` · `max` |
| الـ stack لمشروع جديد؟ | Bun · Hono · Drizzle · PostgreSQL · Next.js · Node · Express · React · Python · FastAPI · حسب كل مشروع | `stack` (text; "حسب كل مشروع" = don't write it) |

## 3. Round 3: rules and storage

| Question | Options | Key |
|---|---|---|
| القواعد اللي تتفرض بالـ hooks؟ (**multiSelect**) | commits بالإنجليزي وبلا توقيع AI · فحص الأسرار قبل الـ commit · كود بلا كومنتات · هيكل Next.js + تحذير التكرار | `settings.commit_style` · `secret_scan` · `comment_discipline` · `nextjs_structure` + `duplication_warning` (unselected = `false`) |
| ذاكرة المشروع؟ | جوه المشروع في `.agents/` وبتدخل git · افتراضي Claude Code (`~/.claude`) | `settings.project_storage` |
| حاجات تانية؟ (**multiSelect**) | أصوات الإشعارات · نسخ الـ transcripts في `.agents/sessions/` · تذكير team review بعد تعديل كود · تنبيه Freelancer-Trap في الصفقات | `sounds` · `keep_transcripts` · `team_review_reminder` · `deal_economics` |
| سياق شخصي؟ | أكتبه دلوقتي (أهداف، قيود، استضافة مفضّلة…) · استورد PersonalContext.md (لو لقيته) · لأ | `profile.md` |

## 4. Save

Combine answers into one JSON and save it. Never edit the file by hand:

```bash
python3 "<kit>/hooks/kit_profile.py" set '{"name":"…","language":"ar-eg","verbosity":"concise","role":"…","mode":"cto-pm","questions":"ask","cost_profile":"balanced","stack":"…","settings":{"commit_style":true,"secret_scan":true,"comment_discipline":true,"nextjs_structure":true,"duplication_warning":true,"project_storage":true,"sounds":true,"keep_transcripts":true,"team_review_reminder":true,"deal_economics":false}}'
```

- Personal context: `python3 "<kit>/hooks/kit_profile.py" context "<markdown>"`. Keep it short, with headings; it is read only for strategic decisions.
- **Single-project setting** (if requested): same command with `set --project`; written to `<project>/.agents/profile.json`, overrides the global one in that project only.
- **Hosting** if mentioned: `"hosting": "…"`. Important extra **notes**: `"notes": ["…"]`.

## 5. Close

1. Show what was saved with `python3 "<kit>/hooks/kit_profile.py" render` (exactly what will be injected).
2. One line: takes effect from the **next session**; change anytime with `/sabry-kit:kit-setup`.
3. Suggest `/sabry-kit:kit-doctor` to check for plugins/skills/agents that conflict with these settings.

## Rules

- Don't ask what you can find out (git name; the stack from the current project's `package.json` as a suggestion).
- Every option gets a short trade-off description; recommended option first, marked "(توصية)".
- User said "leave default" -> save the default, don't re-ask.
- Secrets or passwords in the personal context -> don't save them, and say why.
