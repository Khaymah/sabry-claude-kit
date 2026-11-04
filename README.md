<div dir="rtl">

# sabry-claude-kit

**العربية** · [English](README.md)

إعداد وكيل البرمجة بالذكاء الاصطناعي الخاص بي في ريبو واحد، قابل للنقل: قواعد، وكلاء (agents)، مهارات (skills)، hooks، أنماط، وقرارات. تسحبه على أي جهاز أو سيرفر أو VPS وتكمل شغلك بنفس الأسلوب ونفس المعايير، من غير ما تعيد ضبط الإعدادات كل مرة.

مبني لـ [Claude Code](https://www.anthropic.com/claude-code). وأجزاء منه تشتغل كمان مع Codex CLI و Gemini CLI و Cursor وأدوات تانية (شوف [أدوات أخرى](#4-أدوات-أخرى)).

---

## الفهرس

1. [إيه هو الكيت ده؟](#إيه-هو-الكيت-ده)
2. [هيكل الريبو](#هيكل-الريبو)
3. [التنصيب](#التنصيب)
   - [1. Claude Code كـ plugin](#1-claude-code-كـ-plugin)
   - [2. Claude Code على مستوى الجهاز (symlinks)](#2-claude-code-على-مستوى-الجهاز-symlinks)
   - [3. Claude Code لمشروع واحد](#3-claude-code-لمشروع-واحد)
   - [4. أدوات أخرى](#4-أدوات-أخرى)
4. [التحديث](#التحديث)
5. [الشغل على جهاز جديد](#الشغل-على-جهاز-جديد)
6. [التخصيص](#التخصيص)
7. [ملاحظات أمنية](#ملاحظات-أمنية)
8. [المساهمة](#المساهمة)

---

## إيه هو الكيت ده؟

أي حد بيستخدم Claude Code فترة بيبدأ يظبّط فيه حاجات: قواعد، agents مخصصة، skills، hooks، ومعيار جودة. الإعدادات دي بتفضل في `~/.claude` على جهاز واحد، وأي لابتوب أو سيرفر جديد بيبدأ من الصفر.

**sabry-claude-kit** بيجمع كل ده في ريبو Git واحد، فالانتقال لبيئة جديدة يبقى `git clone` وكام أمر.

وكمان بيحفظ اللي اتعلمته في الطريق: أنماط نجحت، وأنماط لازم نتجنبها، وأسباب القرارات التقنية.

## هيكل الريبو

### الفولدرات

| الفولدر | الغرض |
|---|---|
| `.claude-plugin/` | ملف تعريف الـ plugin عشان الكيت يتحمّل كـ plugin في Claude Code |
| `agents/` | تعريفات الـ sub-agents المخصصة |
| `skills/` | مهارات قابلة لإعادة الاستخدام، بيحمّلها الوكيل لما المهمة تناسبها |
| `hooks/` | Hooks بتشتغل تلقائيًا في نقاط محددة من الـ workflow |
| `rules/` | ملفات قواعد بتحدد طريقة كتابة ومراجعة الكود |
| `Patterns/` | أساليب نجحت وتستاهل التكرار |
| `Anti-patterns/` | أساليب لازم نتجنبها، وليه |
| `Decisions/` | القرارات التقنية وأسبابها |
| `Roles/` | بروفايلات أدوار يشتغل الوكيل على أساسها |
| `Stacks/` | إرشادات خاصة بكل stack تقني |
| `agent-memory/` | ملاحظات دائمة محفوظة للوكلاء بين الجلسات |
| `sounds/` | ملفات صوتية للإشعارات |
| `_Audit/` | مخرجات المراجعة والتدقيق |
| `_Archive/` | مواد قديمة محفوظة للرجوع إليها |

### الملفات في الجذر

| الملف | الغرض |
|---|---|
| `CLAUDE.md` | التعليمات الرئيسية اللي بتتحمّل في كل جلسة |
| `settings.json` | إعدادات Claude Code (الصلاحيات، ربط الـ hooks، وغيرها) |
| `.claude.json` | إعدادات عميل Claude Code |
| `Quality-Gate.md` | قائمة الجودة اللي لازم الشغل يعدّيها قبل ما يتحسب منتهي |
| `seatbelt.json` | إعدادات حماية وأمان |
| `AGENT_LEARNINGS.md` | دروس اتجمعت من شغل الوكلاء |
| `CommunicationProfiles.md` | إزاي الوكيل يتواصل في المواقف المختلفة |
| `PersonalContext.md` | خلفية شخصية يعرفها الوكيل (عدّلها بتفاصيلك أنت) |
| `.sabry-kit-maintain-note` و `.self-maintain-last` | علامات بتُستخدم في صيانة الكيت وتحديثه |

---

## التنصيب

### المتطلبات

- Git
- وكيل برمجة: [Claude Code](https://www.anthropic.com/claude-code) (دعم كامل)، أو أداة من [أدوات أخرى](#4-أدوات-أخرى) (دعم جزئي)
- macOS أو Linux أو WSL أو Windows PowerShell

الأول، اسحب الريبو مرة واحدة:

```bash
git clone https://github.com/Khaymah/sabry-claude-kit.git ~/sabry-claude-kit
```

### 1. Claude Code كـ plugin

أسرع طريقة للتجربة. شغّل Claude Code والكيت متحمّل لجلسة واحدة:

```bash
claude --plugin-dir ~/sabry-claude-kit
```

أو نصّبه من ريبو GitHub من جوه Claude Code:

```text
/plugin marketplace add Khaymah/sabry-claude-kit
/plugin install sabry-kit@sabry-kit
```

اكتب `/plugin` عشان تشوف اسم الـ marketplace بالظبط، وتفعّل أو تعطّل أو تحدّث.

> الـ plugin بيحمّل `agents/` و `skills/` و `hooks/`. أما ملفات زي `CLAUDE.md` و `settings.json` فالتنصيب كـ plugin مش بيطبّقها، فاستخدم الطريقة 2 كمان لو عايز تعليمات الكيت وإعداداته على مستوى الجهاز.

### 2. Claude Code على مستوى الجهاز (symlinks)

الطريقة دي بتديك الكيت كامل في كل مشروع، و `git pull` بيحدّثه فورًا.

**macOS / Linux / WSL**

```bash
# خد نسخة احتياطية من اللي عندك
cp -r ~/.claude ~/.claude.backup 2>/dev/null

mkdir -p ~/.claude
KIT=~/sabry-claude-kit

ln -sfn "$KIT/CLAUDE.md"     ~/.claude/CLAUDE.md
ln -sfn "$KIT/settings.json" ~/.claude/settings.json
ln -sfn "$KIT/agents"        ~/.claude/agents
ln -sfn "$KIT/skills"        ~/.claude/skills
ln -sfn "$KIT/hooks"         ~/.claude/hooks
ln -sfn "$KIT/rules"         ~/.claude/rules
```

**Windows (PowerShell، شغّله Administrator أو مع تفعيل Developer Mode)**

```powershell
$Kit = "$HOME\sabry-claude-kit"
New-Item -ItemType Directory -Force "$HOME\.claude" | Out-Null

New-Item -ItemType SymbolicLink -Force -Path "$HOME\.claude\CLAUDE.md"     -Target "$Kit\CLAUDE.md"
New-Item -ItemType SymbolicLink -Force -Path "$HOME\.claude\settings.json" -Target "$Kit\settings.json"
New-Item -ItemType SymbolicLink -Force -Path "$HOME\.claude\agents"        -Target "$Kit\agents"
New-Item -ItemType SymbolicLink -Force -Path "$HOME\.claude\skills"        -Target "$Kit\skills"
New-Item -ItemType SymbolicLink -Force -Path "$HOME\.claude\hooks"         -Target "$Kit\hooks"
New-Item -ItemType SymbolicLink -Force -Path "$HOME\.claude\rules"         -Target "$Kit\rules"
```

> ⚠️ الـ symlinks مش بتشغّل الـ hooks. الـ hooks كلها متسجلة في `hooks/hooks.json` وبتيجي من الـ plugin (الطريقة 1) بمسارات `${CLAUDE_PLUGIN_ROOT}`، فشغّالة على أي جهاز من غير تعديل. التفاصيل والتحقق في [hooks/README.md](hooks/README.md).

بعد كده شغّل Claude Code في أي مشروع:

```bash
claude
```

### 3. Claude Code لمشروع واحد

لو عايز الكيت في مشروع واحد بس، انسخ الأجزاء اللي عايزها لفولدر `.claude/` بتاع المشروع:

```bash
cd your-project
mkdir -p .claude
cp ~/sabry-claude-kit/CLAUDE.md ./CLAUDE.md
cp -r ~/sabry-claude-kit/agents ~/sabry-claude-kit/skills ~/sabry-claude-kit/rules .claude/
```

ملفات المشروع بتأثر على أي حد بيسحب المشروع، فانسخ بس اللي عايز تشاركه مع الفريق.

### 4. أدوات أخرى

الكيت مبني حوالين Claude Code. الأدوات التانية تقدر تستفيد من الأجزاء المكتوبة: التعليمات والقواعد والأنماط والقرارات. الأجزاء الخاصة بـ Claude (`agents/` و `settings.json` و `.claude.json` و `.claude-plugin/`) مش هتشتغل هناك. أما الـ hooks فبتشتغل في Codex وGemini CLI وCursor عن طريق `hooks/adapt.py`، والإعداد لكل أداة في [hooks/README.md](hooks/README.md#5-أدوات-تانية-codex--gemini-cli--cursor).

**Codex CLI**

Codex بيقرأ ملف `AGENTS.md`. استخدم تعليمات الكيت كملف عام:

```bash
mkdir -p ~/.codex
cp ~/sabry-claude-kit/CLAUDE.md ~/.codex/AGENTS.md
```

لمشروع واحد، حطه في جذر المشروع باسم `AGENTS.md`. ولو نسخة Codex عندك بتدعم الـ skills، وجّهها لفولدر `skills/` حسب وثائق Codex.

**Gemini CLI**

```bash
mkdir -p ~/.gemini
cp ~/sabry-claude-kit/CLAUDE.md ~/.gemini/GEMINI.md
```

**Cursor**

انسخ ملفات القواعد لمشروعك:

```bash
mkdir -p .cursor/rules
cp ~/sabry-claude-kit/rules/* .cursor/rules/
```

Cursor بيتوقع ملفات `.mdc` أو `.md` بـ front matter خاص بيه، فعدّل الامتداد والهيدر لو قاعدة مااتحمّلتش.

**Windsurf و Copilot وغيرهم**

معظم الوكلاء بتقرأ ملف تعليمات Markdown (`AGENTS.md` أو `.github/copilot-instructions.md` أو `.windsurfrules` وهكذا). انسخ محتوى `CLAUDE.md` في الملف اللي أداتك بتتوقعه.

**Claude.ai / Claude Desktop**

الـ skills ممكن تتضغط zip وتترفع من قسم Skills في إعدادات Claude. اضغط skill واحدة في كل مرة.

---

## التحديث

```bash
cd ~/sabry-claude-kit
git pull
```

مع طريقة الـ symlinks مفيش حاجة تانية مطلوبة. ومع طريقة النسخ، انسخ الملفات اللي اتغيّرت تاني.

ولحفظ تعديل عملته أثناء الشغل:

```bash
cd ~/sabry-claude-kit
git add -A
git commit -m "Update kit"
git push
```

## الشغل على جهاز جديد

```bash
git clone https://github.com/Khaymah/sabry-claude-kit.git ~/sabry-claude-kit
# بعدين شغّل أوامر الـ symlinks من الطريقة 2
claude
```

## التخصيص

- عدّل `CLAUDE.md` لتغيير التعليمات العامة.
- ضيف skill جديدة بعمل فولدر تحت `skills/` فيه `SKILL.md`.
- ضيف agent جديد بإضافة ملف Markdown تحت `agents/`.
- سجّل أي اختيار تقني في `Decisions/`، وانقل اللي بتتعلمه لـ `Patterns/` أو `Anti-patterns/`.
- استبدل محتوى `PersonalContext.md` و `CommunicationProfiles.md` بالخاص بيك.

## ملاحظات أمنية

الريبو ده ممكن يحتوي على إعدادات شخصية لصاحبه. قبل ما تعيد استخدامه أو تنشر نسختك منه:

- راجع `PersonalContext.md` و `CommunicationProfiles.md` وشوف فيهم تفاصيل شخصية.
- راجع `.claude.json` و `settings.json` و `hooks/` وشوف فيهم tokens أو مفاتيح API أو روابط داخلية أو مسارات خاصة بجهاز معين.
- خلّي الأسرار في متغيرات البيئة أو مدير أسرار، ومتحطهاش في الريبو أبدًا.
- اقرأ `settings.json` قبل ما تطبّقه. ممكن يمنح صلاحيات ويشغّل hooks على جهازك.

## المساهمة

الـ Issues والـ Pull Requests مرحّب بيها. اقرأ ميثاق السلوك الموجود في الريبو الأول.

</div>
