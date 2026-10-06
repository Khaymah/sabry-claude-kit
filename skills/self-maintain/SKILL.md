---
name: self-maintain
description: Keep Sabry's agents and rules current - review them against the latest Claude Code best practices and his accumulated learnings, then open a PR with focused, justified improvements. Never auto-merges. Run on a schedule (claude.ai routine) or on demand.
---

# الصيانة الذاتية لـ sabry-kit

الهدف: إبقاء الـ `agents/` و `rules/` على **أحدث أفضل الممارسات** — بمراجعة وPR، **بلا auto-merge أبداً**.
إعدادات Sabry بتأثّر على كل شغله، فأي تغيير لازم يعدّي بمراجعته.

## المصادر اللي تقرأها أول

1. **تحديثات Claude Code وأفضل ممارساته:**
   - `WebFetch` على `https://code.claude.com/docs/en/release-notes` (أحدث التغييرات).
   - صفحات docs اللي تخص ما تبنيه: `sub-agents`, `skills`, `hooks`, `plugins`, `memory`, `settings`.
2. **دروس Sabry المتراكمة (في نفس الريبو):**
   - `AGENT_LEARNINGS.md`
   - `agent-memory/` (+ أي ذاكرة من plugin `remember`)
   - `Anti-patterns/`, `Patterns/`, `Decisions/`

## الخطوات

1. اقرأ المصادر أعلاه وحدّد ما الجديد/المتغيّر فعلاً من آخر مراجعة.
2. لكل ملف في `agents/` و `rules/`: قيّمه مقابل الجديد + الدروس. حدّد **تحسين محدد** (سلوك/دقة/مواكبة ميزة جديدة) — **مش تجميل**.
3. طبّق التعديلات على فرع جديد `self-maintain/<YYYY-MM-DD>`.
4. افتح **PR** على `sabrydawood/sabry-claude-kit`:
   - العنوان والجسم **بالإنجليزي**.
   - الجسم: فقرة Before وفقرة After، وبند لكل تغيير بسببه ومصدره (release note / درس).
5. **ممنوع auto-merge** — استنى مراجعة Sabry ودمجه.

## حدود صارمة (قواعد Sabry)

- **لا نسبة لـ AI في git** (لا `Co-Authored-By` ولا `Generated with`) — رسائل commit/PR إنجليزي.
- كل agent يفضل `model: opus` في الـ frontmatter.
- تغييرات **مركّزة ومبرّرة فقط**. لو مفيش تحسين حقيقي النهاردة → **اقفل بلا PR** وبلّغ بسطر واحد: "مفيش تحديث مطلوب".
- ماتلمسش ملفات الحساب الشخصية (`.claude.json`, `settings.json`) — المهمة على `agents/` و `rules/` بس (و`commands/` لو لزم).

## التشغيل

- يدوي: `/sabry-kit:self-maintain`.
- مجدول: روتين claude.ai أسبوعي على الريبو ده، مهمته سطر واحد: `Run /sabry-kit:self-maintain`.
