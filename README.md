<div dir="rtl">

# sabry-kit

**العربية** · [English](README.en.md)

عقل واحد لوكيل البرمجة بتاعك، بيتنقل معاك على أي جهاز. بيسألك عن طريقتك مرة واحدة ويحفظها كإعدادات بأولوية قصوى، وبيشيل ذاكرة كل مشروع جوه المشروع نفسه. وبيمنع الأسرار من إنها تتعمل لها commit، وبيكتشف أي plugin أو إعداد متعارض معاه ويصلّحه بموافقتك.

مبني لـ [Claude Code](https://code.claude.com) كـ plugin، وبيتثبّت كمان في Codex CLI و Kimi Code و OpenCode و Kilo Code و Cline بسكربت واحد ([إزاي](#codex-cli-و-kimi-code-cli-كل-أداة-لوحدها)). والـ hooks بتاعته بتشتغل في Codex CLI وGemini CLI وCursor ([التفاصيل](hooks/README.md#8-أدوات-تانية-codex--gemini-cli--cursor)).

---

## الفهرس

1. [البداية السريعة](#البداية-السريعة)
2. [بيعمل إيه](#بيعمل-إيه)
3. [الأوامر](#الأوامر)
4. [عيلة الـ agents](#عيلة-الـ-agents)
5. [جوه كل مشروع: `.agents/`](#جوه-كل-مشروع-agents)
6. [الإعدادات بتاعتك (الـ profile)](#الإعدادات-بتاعتك-الـ-profile)
7. [جلسات السحابة](#جلسات-السحابة-claude-code-على-الويب)
8. [التكلفة والأداء](#التكلفة-والأداء)
8. [هيكل الريبو](#هيكل-الريبو)
9. [طرق تنصيب تانية](#طرق-تنصيب-تانية)
10. [التحديث](#التحديث)
11. [التخصيص](#التخصيص)
12. [الأمان والخصوصية](#الأمان-والخصوصية)

---

## البداية السريعة

**1. نصّب الـ plugin** من جوه Claude Code:

```text
/plugin marketplace add Khaymah/sabry-claude-kit
/plugin install sabry-kit@sabry-kit
```

**2. الإعداد لأول مرة:** دقيقتين أسئلة، وإجاباتك بتتحفظ كإعدادات بأولوية قصوى:

```text
/sabry-kit:kit-setup
```

**3. فحص التعارضات:** بيلاقي أي plugin أو skill أو hook أو إعداد بيتعارض مع الكيت، ويصلّح بموافقتك بس:

```text
/sabry-kit:kit-doctor
```

**4. افتح أي مشروع.** فولدر `.agents/` بيتجهّز لوحده، ومن الجلسة اللي بعدها الذاكرة والخطط بتتكتب جوه المشروع.

> المتطلبات: Python 3.8+ على PATH (الـ hooks كلها stdlib بس) وGit. شغّال على Windows وmacOS وLinux وفي جلسات Claude Code السحابية.

---

## بيعمل إيه

| الميزة | التفاصيل |
|---|---|
| 👤 **Profile بأولوية قصوى** | `/sabry-kit:kit-setup` بيسأل عن الاسم، واللغة، وأسلوب الرد، ووضع العمل، والـ stack، والتكلفة مقابل الجودة، والقواعد. الإجابات بتتحقن **أول حاجة** في كل جلسة، وبتغلب أي قاعدة أو CLAUDE.md أو plugin تاني |
| 🗂️ **ذاكرة كل مشروع جواه** | الـ auto memory، وذاكرة الـ agents، والخطط، والملفات المؤقتة، ونسخ الجلسات بتتخزن في `.agents/` جوه المشروع، مش في `~/.claude`. لو شلت الكيت، مفيش حاجة بتضيع |
| 🧭 **بيبدأ وهو عارف المشروع** | في أول كل جلسة: الـ stack، وأوامر التحقق، والفولدرات، وحالة git، وآخر "الجاي" من `Plan/Progress`. ملخص صغير من غير استكشاف |
| 🔐 **فحص الأسرار قبل كل commit** | مفاتيح API وtokens وprivate keys وملفات `.env`. بيشتغل كـ hook في Claude Code وكـ git pre-commit، فبيحمي المشروع من أي أداة أو أي شخص |
| 🩺 **فحص التعارضات** | `/sabry-kit:kit-doctor` بيفحص كل اللي متسطّب عندك ويعرض التعارضات بالخطورة. بيصلّح بموافقتك، مع backup ورجوع بأمر واحد. ومرة في اليوم بينبّهك لو فيه تعارض خطير |
| 🎭 **عيلة agents** | 24 agent بأدوار واضحة (CTO · PM · BA · Market Research · Security · DevOps …)، كلهم بنفس الشكل المختصر، وكل واحد بيقرا ملف الدور بتاعه من `Roles/` |
| 🔒 **قواعد مفروضة بـ hooks** | commits بالإنجليزي ومن غير توقيع AI · كود بلا كومنتات · هيكل Next.js · تحذير التكرار · تذكير team review. كل قاعدة تقدر تقفلها من الـ profile |
| 🎓 **بيتعلّم من تصحيحك** | لما تقوله "غلط" أو "قلتلك"، الدرس بيتسجّل في `.agents/memory/lessons.md` وبيظهر في الجلسات اللي بعدها عند نفس الملف أو الأمر. الدرس اللي يتكرر في مشروعين بيبقى عام |
| 🗺️ **المهام الطويلة مابتتوهش** | خطة بـ checkboxes في `.agents/plans/`، بتظهر في أول كل جلسة بأول بند مش متعلّم، وحالتها بتتحفظ قبل ضغط الـ context وبترجع بعده |
| 🎼 **تنسيق الفريق** | `/sabry-kit:kit-orchestrate`: 7 playbooks بتسلسل ثابت، ملف handoff واحد، وجدول في الآخر بيقفل كل بند في المطلوب |
| ✅ **معيار "خلصت"** | لكل نوع مهمة (feature · bugfix · refactor · migration)، مع مراجعة بسياق نضيف للتغييرات الكبيرة أو الحساسة |
| 🔌 **أي AI agent** | `kit_install.py` بيثبّت التعليمات والـ skills والـ agents في Codex · Kimi · OpenCode · Kilo Code · Cline بصيغة كل أداة، و`hooks/adapt.py` بيشغّل نفس الـ hooks في Codex و Kimi و Gemini CLI و Cursor |
| 💸 **تكلفة أقل** | context أصغر في كل جلسة، و agents أخف، وافتراضيات أوفر ([التفاصيل](#التكلفة-والأداء)) |

---

## الأوامر

| الأمر | بيعمل إيه |
|---|---|
| `/sabry-kit:kit-setup` | الإعداد لأول مرة أو تعديل إعداداتك |
| `/sabry-kit:kit-doctor` | فحص التعارضات وإصلاحها بموافقتك |
| `/sabry-kit:kit-stats` | فين التوكنز راحت: لكل جلسة، ولكل أداة، وأكبر النتايج، والملفات اللي اتقرت أكتر من مرة، ونصايح للتوفير بالأرقام |
| `architecture-decision` | بيتحمّل لوحده عند قرار معماري (stack · schema · API · auth): Quality-Gate + ADR |
| `/sabry-kit:team-review` | مراجعة متوازية للتعديلات (أمان · صحة · اختبارات · UX)، وكل نتيجة بتتراجع قبل ما تتعرض |
| `/sabry-kit:kit-orchestrate` | تنسيق كذا agent على شغلانة واحدة بـ playbook ثابت (feature · bugfix · فكرة · release · ربط خارجي · شكوى عميل · عرض لعميل)، بملف handoff واحد وجدول تغطية للمطلوب في الآخر |
| `/sabry-kit:project-audit` | تدقيق شامل لمشروع: أمان وجودة وأداء ومعمارية، وتقرير بالعربي |
| `/sabry-kit:self-maintain` | صيانة الكيت نفسه: بيفتح PR بالتحسينات، ومن غير دمج تلقائي |
| `/sabry-kit:brag-slim` | فيديو إطلاق قصير لمشروع أو موقع |
| `aurora-dark-ui` · `moonflower-design-system` | design systems بتتحمّل تلقائياً لما الشغل يكون واجهة بالستايل ده |

> الأسامي اتختارت عشان ماتتصادمش مع أوامر Claude Code المدمجة (زي `/doctor`) أو مع plugins تانية، و`kit-doctor` بينبّهك لو حصل تصادم بعد كده.

---

## عيلة الـ agents

الدور المناسب بيتفعّل تلقائياً من سياق الطلب (الجدول الكامل في [Roles/README.md](Roles/README.md)). الموديل بيتحدد من `model:` في ملف كل agent، وكلهم دلوقتي `sonnet`.

| المجال | الـ agents |
|---|---|
| القرار والمنتج | `cto` · `senior-pm` · `business-analyst` · `market-researcher` · `growth-strategist` · `business-developer` |
| التسليم والعملاء | `delivery-manager` · `proposal-writer` · `support-triage` |
| البيانات والوصول | `data-analyst` · `seo-content` |
| الربط الخارجي | `integration-engineer` |
| التنفيذ | `senior-engineer` · `backend-architect` · `Frontend Developer` · `mobile-developer` · `ai-engineer` · `Database-Optimizer` · `devops-sre` · `qa-tester` · `tech-writer` |
| المراجعة والتصميم | `code-reviewer` · `security-reviewer` (مراجعة أمنية + threat modeling) · `ui-ux` (تصميم + مراجعة UX) |

الترتيب لفكرة منتج جديدة: `market-researcher` (تستاهل؟) ← `senior-pm` (نبني إيه؟) ← `business-analyst` (المتطلبات) ← `cto` (المعمارية).

---

## جوه كل مشروع: `.agents/`

```text
your-project/
  .agents/
    memory/          الـ auto memory (MEMORY.md + ملف لكل موضوع)        ✅ git
    agent-memory/    ذاكرة كل agent (.claude/agent-memory بيشاور هنا)   ✅ git
    plans/           خطط plan mode                                       ✅ git
    scratch/         الملفات المؤقتة بدل /tmp                           ❌
    sessions/        نسخ الجلسات                                         ❌
    profile.json     (اختياري) إعدادات خاصة بالمشروع ده
    secrets-allowlist  (اختياري) استثناءات فحص الأسرار
```

- **أول جلسة في المشروع:** بتجهّز ده لوحدها. الـ hook بيعدّي لو كان متجهّز قبل كده.
- **الذاكرة القديمة:** بتتنسخ مرة واحدة من `~/.claude/projects/`، والأصل بيفضل زي ما هو.
- **ملفات المشروع:** ولا ملف tracked بيتعدّل. المسارات الخاصة بالجهاز بتتكتب في `.git/info/exclude`.
- **من إمتى:** Claude Code بيقبل مسار الذاكرة الجديد من **الجلسة اللي بعدها**.
- **الذاكرة بتدخل git:** عشان تروح مع المشروع لأي جهاز. وفحص الأسرار بيوقف أي commit فيه سر.

التفاصيل والتحكم: [hooks/README.md › التخزين](hooks/README.md#5-التخزين-جوه-المشروع-agents).

---

## الإعدادات بتاعتك (الـ profile)

| الملف | فيه إيه |
|---|---|
| `~/.agents/profile.json` | إجابات `kit-setup` ومفاتيح تشغيل القواعد (`settings`) |
| `~/.agents/profile.md` | سياق شخصي حر (أهداف، قيود، استضافة مفضّلة). بيتقري عند القرارات الاستراتيجية بس |
| skill `sabry-profile` على claude.ai | نفس الاتنين في zip واحد بترفعه مرة: بيوصل لكل جهاز وكل جلسة سحابية. الأحدث بينه وبين الملف المحلي هو اللي بيتاخد |
| `<project>/.agents/profile.json` | override لمشروع واحد |

- **الترتيب:** افتراضيات الكيت < `~/.agents/profile.json` < profile المشروع < متغيرات `SABRY_KIT_<KEY>` (مثلاً `SABRY_KIT_SOUNDS=0`).
- **قاعدة مقفولة:** مش بتتحقن أصلاً، والـ hook بتاعها بيسكت.
- **مكان الملفات:** بياناتك الشخصية بتتحفظ برّه ريبو الكيت دايماً، فالكيت نفسه يفضل عام وينفع يتشارك.

قايمة المفاتيح كاملة: [hooks/README.md › الـ profile](hooks/README.md#2-الـ-profile-إعداد-أول-مرة).

---

## جلسات السحابة (Claude Code على الويب)

كل جلسة سحابية بتبدأ في container جديد بيتمسح بعدها، وبتتجاهل `~/.claude/settings.json` و`.claude/settings.local.json`. الكيت بيتعامل مع ده كده:

| الحاجة | في السحابة |
|---|---|
| الـ plugin | بيوصل بالمزامنة مع claude.ai، من غير أي خطوة |
| الـ profile | **مرة واحدة للحساب كله:** `kit-setup` بيبني `sabry-profile.zip`، وإنت ترفعه على claude.ai ← Settings ← Skills، فيتزامن لكل البيئات السحابية وكل أجهزتك. احتياطي: متغيّر `SABRY_KIT_PROFILE_JSON` على البيئة، و`.agents/profile.json` في المشروع بيغلب الكل |
| الـ auto memory | `autoMemoryDirectory` بيتجاهل هناك، فالكيت بينسخ `.agents/memory` للمكان اللي Claude Code بيقرا منه في أول الجلسة، ويرجّع أي ذاكرة جديدة لـ `.agents/memory` في آخر كل دور |
| الخطط | الخطط الجديدة من `~/.claude/plans` بتتنقل لـ `.agents/plans` |
| ذاكرة الـ agents · فحص الأسرار | شغالين زي ما هما: الـ link والـ pre-commit بيتعملوا من جديد كل جلسة |
| `/sabry-kit:kit-stats` | ملخص أرقام بس (من غير أسماء ملفات أو أوامر) في `.agents/usage.jsonl` بيدخل git، فإحصائيات السحابة مش بتضيع |
| **الحفظ** | أي حاجة في `.agents/` لازم يتعمل لها commit و push قبل ما الـ container يتمسح. الكيت بيفكّر الـ agent مرة لكل مجموعة تغييرات |

**ليه مش أوتوماتيك 100%؟** Claude Code بيـ**نزّل** الـ skills والـ plugins من حسابك بس، وعمره ما بيرفع. فرفع الـ zip مرة واحدة هو الخطوة الوحيدة اليدوية، وبعدها مفيش أي إعداد لكل بيئة أو جهاز. الكيت نفسه متزامن لكل مكان أصلاً لأنه plugin على حسابك.

## التكلفة والأداء

| الإجراء | الأثر |
|---|---|
| الـ profile بيتحقن كملخص (~1KB) والسياق الشخصي بيتقري عند الحاجة بس | بدل 9KB في كل جلسة |
| قاعدة مقفولة في الـ profile مش بتتحقن أصلاً · القواعد الخاصة بنوع ملفات (`paths:`) بتتحقن كمؤشر · `code-tools` بس لو `code-review-graph` متسطّب | ~15% أقل context في كل جلسة |
| الـ agents كلها على نفس الشكل المختصر (اتشال تكرار تعليمات الذاكرة اللي Claude Code بيحقنها لوحده) | 3 agents من 52KB لـ 8KB |
| الافتراضي: `effortLevel: high` · `autoCompactWindow: 200000` · `CLAUDE_CODE_MAX_OUTPUT_TOKENS: 32000` · `BASH_MAX_OUTPUT_LENGTH: 20000` | سياق أصغر في كل دور ومخرجات أقصر |
| قالب تكليف للـ subagents (`rules/subagents.md`): هدف + اللي اتستبعد + حد لطول التقرير | تقارير أقصر بتدخل الـ context الرئيسي |
| `cost_profile` في الـ profile + `/sabry-kit:kit-doctor` بيقارن الإعدادات بيه | تنبيه لو الإعدادات أغلى من اختيارك |
| تعليمات الموديل كلها بالإنجليزي (القواعد · Roles · agents · skills)، والرد بلغتك | الزيادة الثابتة للكيت في أول كل جلسة من ~7.2k لـ ~5.6k توكن (−22%)، مقاسة بالـ evals |
| عدّاد التوكنز (`usage.py`) + `/sabry-kit:kit-stats` | كل جلسة بتتقاس: فين الهدر بالظبط |
| `read-budget`: مفيش قراءة كاملة لملف أكبر من 800 سطر من غير قصد | قراءة الجزء المطلوب بس، لأن النتيجة بتتبعت تاني في كل دور |
| `verify-reminder`: تذكير بالتحقق قبل "خلصت" بأوامر المشروع نفسه | أخطاء أقل ورجوع أقل |
| `lessons`: تصحيح المالك بيتسجّل سطر في `.agents/memory/lessons.md` وبيظهر في الجلسات اللي بعدها عند نفس الملف أو الأمر | الغلط مايتكررش، ومن غير إعادة شرح |
| `kit_plans`: المهمة الطويلة ليها خطة بـ checkboxes في `.agents/plans/<slug>/plan.md`، بتظهر في ملخص كل جلسة وبتتحفظ حالتها قبل ضغط الـ context | الجلسة الجديدة بتكمّل من أول بند مش متعلّم بدل ما تعيد الاستكشاف |

---

## هيكل الريبو

| المسار | الغرض |
|---|---|
| `.claude-plugin/` | تعريف الـ plugin والـ marketplace |
| `agents/` | الـ 24 agent |
| `Roles/` | ملف تفصيلي لكل دور (إطار التفكير · قالب الرد · anti-patterns)، والـ agent بيقراه قبل ما يشتغل |
| `rules/` | القواعد اللي بتتحقن في كل جلسة (التواصل · وضع العمل · اللغة · الكومنتات · الـ subagents · التخزين …) |
| `skills/` | الأوامر والـ design systems (الجدول فوق) |
| `hooks/` | كل الـ hooks + `kit_profile.py` + `doctor.py` + `adapt.py` + الاختبارات. **دليلها الكامل: [hooks/README.md](hooks/README.md)** |
| `sounds/` | أصوات الإشعارات + `play.py` (Windows · macOS · Linux) |
| `Stacks/` | إرشادات لكل stack (Next.js · Bun/Hono · Node · React · Go · Rust · PHP · .NET · Astro · GraphQL) |
| `Patterns/` · `Anti-patterns/` · `Decisions/` | المعرفة المتراكمة: اللي نجح، واللي نتجنبه، وأسباب القرارات (ADR) |
| `Quality-Gate.md` | المحاور الثمانية للقرارات المعمارية |
| `CommunicationProfiles.md` | أسلوب الكتابة حسب الجمهور |
| `PersonalContext.md` | **قالب** للسياق الشخصي (الحقيقي في `~/.agents/profile.md`) |
| `CLAUDE.md` · `settings.json` | للتنصيب بالـ symlinks (الطريقة 2 تحت) |
| `_Audit/` · `_Archive/` | مخرجات تدقيق قديمة ومواد محفوظة |

---

## طرق تنصيب تانية

### للتجربة: جلسة واحدة من نسخة محلية

```bash
git clone https://github.com/Khaymah/sabry-claude-kit.git ~/sabry-claude-kit
claude --plugin-dir ~/sabry-claude-kit
```

### `CLAUDE.md` و`settings.json` على مستوى الجهاز (symlinks)

الـ plugin بيجيب الـ agents والـ skills والـ hooks، لكن مش بيطبّق `CLAUDE.md` و`settings.json`. لو عايزهم:

**macOS / Linux / WSL**

```bash
cp -r ~/.claude ~/.claude.backup 2>/dev/null
mkdir -p ~/.claude
KIT=~/sabry-claude-kit
ln -sfn "$KIT/CLAUDE.md"     ~/.claude/CLAUDE.md
ln -sfn "$KIT/settings.json" ~/.claude/settings.json
ln -sfn "$KIT/rules"         ~/.claude/rules
```

**Windows (PowerShell كـ Administrator أو مع Developer Mode)**

```powershell
$Kit = "$HOME\sabry-claude-kit"
New-Item -ItemType Directory -Force "$HOME\.claude" | Out-Null
New-Item -ItemType SymbolicLink -Force -Path "$HOME\.claude\CLAUDE.md"     -Target "$Kit\CLAUDE.md"
New-Item -ItemType SymbolicLink -Force -Path "$HOME\.claude\settings.json" -Target "$Kit\settings.json"
New-Item -ItemType SymbolicLink -Force -Path "$HOME\.claude\rules"         -Target "$Kit\rules"
```

- **`settings.json` بتاع الكيت:** بيعرّف الـ marketplace وبيفعّل `sabry-kit@sabry-kit`، فالـ plugin بيتسطّب لوحده.
- **`agents/` و`skills/` و`hooks/`:** ما تعملش لهم symlink، وإلا كل حاجة هتظهر مرتين، و`kit-doctor` هينبّهك.
- **الـ hooks:** مابتشتغلش من الـ symlinks، بتيجي من الـ plugin بس.

### Codex CLI و Kimi Code CLI (كل أداة لوحدها)

سكربت واحد بيثبّت الكيت في الأداة بصيغتها. محتاج نسخة محلية من الكيت و Python:

```bash
python3 ~/sabry-claude-kit/hooks/kit_install.py --target codex
```

```bash
python3 ~/sabry-claude-kit/hooks/kit_install.py --target kimi
```

| بيتثبّت | Codex CLI | Kimi Code CLI |
|---|---|---|
| التعليمات + الـ profile | بلوك جوه `~/.codex/AGENTS.md` | بلوك جوه `~/.kimi-code/AGENTS.md` |
| الـ skills | `~/.agents/skills/` (مشترك) | `~/.agents/skills/`، وتتنادى بـ `/skill:<name>` |
| الـ agents | `~/.codex/agents/*.toml` | `~/.kimi-code/agents/sabry-kit/*.md` |
| الـ hooks | `~/.codex/hooks.json` | `~/.kimi-code/config.toml` |

- **محتواك مابيتلمسش:** في `AGENTS.md` الكيت بيكتب بين علامتين بس، وأي skill أو agent بنفس الاسم عندك مابيتكتبش فوقه.
- **تجربة من غير كتابة:** `--dry-run`. **إلغاء التثبيت:** `--uninstall` بيشيل اللي الكيت كتبه بس.
- **بعد أي تحديث للكيت أو للـ profile:** شغّل نفس الأمر تاني.
- **الموديلات:** كل agent ليه مستوى (`fast` · `balanced` · `strong`). الافتراضي موديل الأداة، ولو عايز موديل معيّن لمستوى: `"providers": {"codex": {"tiers": {"strong": "<model>"}}}` في الـ profile.
- **الـ hooks بتتثبّت مع الباقي** (في `~/.codex/hooks.json` و`[[hooks]]` جوه `~/.kimi-code/config.toml`، وأي hooks عندك بتفضل زي ما هي):

  | القاعدة | Codex CLI | Kimi Code CLI |
  |---|---|---|
  | منع توقيع الـ AI + commits بالإنجليزي | ✅ | ✅ |
  | فحص الأسرار قبل الـ commit | ✅ | ✅ |
  | كود بلا كومنتات | ✅ (بيقرا الـ `apply_patch`) | ✅ |
  | هيكل Next.js | ❌ | ✅ |
  | هوية git بتاعتك + التوقيع بمفتاحك | ✅ | ✅ |
  | ملخص المشروع في أول الجلسة | ✅ | ✅ (مع أول رسالة) |
  | الأصوات | ✅ | ✅ |
  | الذاكرة جوه المشروع · عدّاد التوكنز · تذكير التحقق | ❌ (معتمدين على صيغة Claude Code) | ❌ |

- **Codex بيطلب مراجعة الـ hooks الجديدة مرة واحدة:** اكتب `/hooks` جوه Codex ووافق. من غير كده مش هتشتغل.
- **لو نقلت فولدر الكيت:** شغّل أمر التثبيت تاني، لأن الـ hooks متسجلة بمساره. `--no-hooks` بيثبّت من غيرها.
- **الدروس:** في Codex و Kimi بتتعرض كلها مع أول رسالة في الجلسة (مفيش تنبيه عند الملف أو الأمر زي Claude Code).

### OpenCode · Kilo Code · Cline (ومنهم بتشغّل GLM)

GLM مالوش CLI رسمي؛ بيتشغّل من الأدوات دي. نفس السكربت:

```bash
python3 ~/sabry-claude-kit/hooks/kit_install.py --target opencode
```

```bash
python3 ~/sabry-claude-kit/hooks/kit_install.py --target kilo
```

```bash
python3 ~/sabry-claude-kit/hooks/kit_install.py --target cline
```

| بيتثبّت | OpenCode | Kilo Code | Cline |
|---|---|---|---|
| التعليمات + الـ profile | بلوك جوه `~/.config/opencode/AGENTS.md` | `~/.config/kilo/sabry-kit.md` + سطر في `instructions` جوه `kilo.jsonc` | `~/.cline/rules/sabry-kit.md` |
| الـ skills | `~/.agents/skills/` (بيقراها تلقائي) | `~/.agents/skills/` (تلقائي) | `~/.cline/skills/` |
| الـ agents | `~/.config/opencode/agents/*.md` | `~/.config/kilo/agents/*.md` | ❌ Cline مافيهوش agents مخصصة: التعليمات بتقوله يقرا ملف الدور ويشتغل بيه |
| الـ hooks | ❌ | ❌ | ❌ |

- **مفيش hooks في التلاتة:** الأدوات دي بتاخد hooks كـ plugin مكتوب بـ JS/TS على الـ SDK بتاعها بس. يعني قواعد الكيت (commits · أسرار · كومنتات) هنا **تعليمات مش منع مفروض**. الـ git pre-commit hook بتاع فحص الأسرار بيفضل شغّال لأنه جوه git نفسه.
- **`kilo.jsonc` فيه كومنتات؟** السكربت مابيلمسوش وبيقولك السطر اللي تضيفه بإيدك في `instructions`.
- **موديل لكل مستوى** (مثلاً GLM): `"providers": {"opencode": {"tiers": {"strong": "<provider>/<model>"}}}` في الـ profile، ونفس الشكل لـ `kilo`. من غيره الـ agents بتاخد موديل الجلسة.
- **ماتجرّبش live:** الصيغ من الـ docs الرسمية (اتراجعت 2026-11-14) والتثبيت متجرّب في home مؤقت، بس مش جوه الأدوات نفسها. لو agent ماظهرش أو ملف ماتقراش، ابعتلي الرسالة.

### Gemini CLI · Cursor · غيرهم

| الأداة | التعليمات | الـ hooks |
|---|---|---|
| Gemini CLI | `cp ~/sabry-claude-kit/CLAUDE.md ~/.gemini/GEMINI.md` | `~/.gemini/settings.json` عن طريق `adapt.py gemini` |
| Cursor | انسخ `rules/` لـ `.cursor/rules/` | `~/.cursor/hooks.json` عن طريق `adapt.py cursor` |
| Windsurf · Copilot · غيرهم | انسخ `CLAUDE.md` لملف التعليمات بتاع الأداة | فحص الأسرار شغال عن طريق الـ git pre-commit |

إعداد جاهز للنسخ لكل أداة، وجدول بيقول إيه اللي بيشتغل فين: [hooks/README.md › أدوات تانية](hooks/README.md#8-أدوات-تانية-codex--gemini-cli--cursor).

---

## التحديث

```text
/plugin update sabry-kit@sabry-kit
```

ولو عامل symlinks أو بتطوّر في الكيت:

```bash
cd ~/sabry-claude-kit && git pull
```

> ⚠️ **تحديث 2026-11:** الـ history بتاع الريبو اتعاد كتابته عشان تتشال منه بيانات شخصية. أي نسخة متكلونة قبل كده محتاجة `git fetch origin && git reset --hard origin/main` (بيمسح التعديلات المحلية اللي مش معمول لها push) أو clone جديد.
> لو فولدر الكيت هو نفسه `~/.claude`: انسخ `.claude.json` لمكان تاني **قبل** الـ reset ورجّعه بعده. اتشال من الريبو لأنه حالة الجهاز بتاعت Claude Code، وبقى في `.gitignore` فمش هيتلمس تاني.

جهاز جديد = نفس "البداية السريعة". الـ profile بيتعمل مرة واحدة لكل جهاز، أو انسخ `~/.agents/profile.json` و`profile.md`.

---

## التخصيص

- **إعداداتك:** `/sabry-kit:kit-setup` في أي وقت. ماتعدّلش ملفات الكيت عشان تغيّر تفضيل شخصي.
- **agent جديد:** ملف تحت `agents/` + ملف دور تحت `Roles/` (الخطوات في [Roles/README.md](Roles/README.md#adding-a-new-role)).
- **skill جديدة:** فولدر تحت `skills/` فيه `SKILL.md` باسم مايتصادمش مع أمر مدمج.
- **hook جديد:** [hooks/README.md › إضافة hook](hooks/README.md#9-إضافة-hook-جديد).
- **قرار تقني:** ADR في `Decisions/`. واللي بتتعلمه يروح `Patterns/` أو `Anti-patterns/`.
- **قياس أي تعديل في الكيت:** [`evals/`](evals/README.md) بيشغّل مهام حقيقية مع الكيت ومن غيره، ويقارن النجاح والتوكنز والتكلفة.
- **التحقق بعد أي تعديل:**

```bash
python3 hooks/verify-hooks.py
```

---

## الأمان والخصوصية

- **الأسرار:** ممنوعة في الريبو وفي `.agents/`. `scan-secrets` بيوقف الـ commit، وفيه `allow-secret` للاستثناء و`git commit --no-verify` للتخطي المقصود.
- **البيانات الشخصية:** بتتحفظ في `~/.agents/` برّه الكيت. ماتحطهاش في `PersonalContext.md` (ده قالب) ولا في أي ملف في الريبو.
- **`settings.json`:** اقراه قبل ما تطبّقه. بيمنح صلاحيات وبيغيّر افتراضيات.
- **`kit-doctor`:** مابيغيّرش أي حاجة من غير موافقتك، وكل تغيير ليه backup في `~/.agents/doctor/runs/` ورجوع بـ `doctor.py undo`.

الـ Issues والـ Pull Requests مرحّب بيها.

</div>
