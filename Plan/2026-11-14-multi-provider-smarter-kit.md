# خطة: كيت يشتغل مع أكتر من مزوّد AI، وأذكى في التنفيذ

- **التاريخ:** 2026-11-14 · **الحالة:** معتمدة · المرحلة 1 خلصت (2026-11-14) · مستنية مراجعة المالك قبل المرحلة 2 · **الإصدار المستهدف:** 0.3.0
- **الطلب:** الكيت يشتغل كويس مع Claude و Codex و Kimi و GLM، ويبقى أذكى (مايكررش الغلط، ينسّق بين الـ agents، جودة تنفيذ أعلى، المهام الطويلة ماتتوهش)، مع 4 agents جداد.

## 1. الوضع الحالي

| الجزء | الحالة |
|---|---|
| Claude Code | دعم كامل (plugin: agents · skills · hooks · profile) |
| Codex CLI · Gemini CLI · Cursor | الـ hooks بس عن طريق `hooks/adapt.py`، وإعداد يدوي. مفيش agents ولا skills ولا profile |
| Kimi · GLM | مفيش أي دعم |
| التعلّم من الأخطاء | ذاكرة عامة بس. مفيش تسجيل تلقائي للتصحيحات |
| التنسيق بين الـ agents | يدوي. الجدول في `Roles/README.md` وصف مش تنفيذ |
| المهام الطويلة | `Plan/Progress` + سطر "الجاي" في ملخص المشروع. مفيش خطة بمراحل بتتتابع |

## 2. حقايق اتأكدت منها من الـ docs الرسمية (2026-11-14)

**قرار المالك:** كل أداة تشتغل لوحدها بالكيت كامل. مفيش تشغيل مزوّد جوه أداة مزوّد تاني.

| | Claude Code | Codex CLI | Kimi Code CLI |
|---|---|---|---|
| التعليمات | حقن بالـ hook | `~/.codex/AGENTS.md` + `AGENTS.md` في المشروع | `~/.kimi-code/AGENTS.md` + `AGENTS.md` في المشروع |
| الـ skills | plugin | `~/.agents/skills/` و `.agents/skills/` (`SKILL.md`) | `~/.agents/skills/` و `~/.kimi-code/skills/` (`SKILL.md`)، تتنادى بـ `/skill:<name>` |
| الـ agents | `agents/*.md` | TOML في `~/.codex/agents/` (`name` · `description` · `developer_instructions` · `model`) | Markdown + frontmatter في `~/.kimi-code/agents/` (`name` kebab-case · `description` · `tools` · `disallowedTools`) |
| الـ hooks | `hooks.json` | `~/.codex/hooks.json` بنفس الشكل ونفس مخرجات المنع | `[[hooks]]` في `~/.kimi-code/config.toml` أو من plugin؛ نفس مخرجات المنع. `SessionStart` مابيحقنش context، و`UserPromptSubmit` بيحقن |
| الـ plugins | `.claude-plugin/plugin.json` | موجودة (الصيغة لسه ما اتراجعتش) | `.kimi-plugin/plugin.json`: skills · agents · hooks · commands، وتتسطّب من رابط GitHub |

- **GLM (Z.ai):** مالوش CLI رسمي. Z.ai بتوثّق تشغيله من Codex CLI و OpenCode و Pi و Crush و Claude Code. يعني دعمه بييجي من دعم الأداة اللي المالك بيشغّله منها (**قرار مفتوح**).
- المصادر: [Codex customization](https://learn.chatgpt.com/docs/customization/overview) · [Codex subagents](https://learn.chatgpt.com/codex/agent-configuration/subagents) · [Kimi agents](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/agents) · [Kimi hooks](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/hooks.html) · [Kimi skills](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/skills.html) · [Kimi plugins](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/plugins.html).

## 3. التصميم

### 3.1 مصدر واحد، وتثبيت لكل أداة

الكيت يفضل مكتوب مرة واحدة، وسكربت واحد يثبّته في كل أداة بصيغتها:

```text
python hooks/kit_install.py --target codex|kimi [--dry-run] [--uninstall]
```

| الجزء | Codex CLI | Kimi Code CLI | المرحلة |
|---|---|---|---|
| التعليمات + الـ profile | بلوك مُدار جوه `~/.codex/AGENTS.md` | بلوك مُدار جوه `~/.kimi-code/AGENTS.md` | 1 |
| الـ skills | نسخ لـ `~/.agents/skills/` (مشترك بين الأداتين) | نفسه | 1 |
| الـ agents | TOML في `~/.codex/agents/` | Markdown في `~/.kimi-code/agents/sabry-kit/` | 1 |
| الـ hooks | `~/.codex/hooks.json` | plugin لـ Kimi أو `[[hooks]]` | 6 · 7 |

- محتوى المستخدم في `AGENTS.md` مابيتلمسش: الكيت بيكتب بين علامتين بس.
- skill أو agent بنفس الاسم عند المستخدم ومش بتاع الكيت مابيتكتبش فوقه، وبيتقال في التقرير.
- كل ملف اتكتب بيتسجّل، و`--uninstall` بيشيل اللي الكيت كتبه بس.

### 3.2 مستويات موديلات بدل أسماء (model tiers)

- كل agent يعلن `tier:` (`fast` · `balanced` · `strong`) جنب `model:` بتاع Claude.
- `providers/<target>.json` يربط كل مستوى بموديل الأداة. القيمة الفاضية معناها "موديل الأداة الافتراضي"، والمالك يحدد موديلاته في الـ profile (`providers.<target>.tiers`).
- الكيت مابيخزّنش أي مفتاح API.

### 3.3 التعلّم من التصحيحات (مايكررش الغلط)

- `UserPromptSubmit` hook يكتشف رسالة تصحيح ("غلط" · "قلتلك" · "مش كده" · "تاني" · "wrong" · "I told you")، ويطلب من الـ agent يسجّل درس قبل ما يكمّل.
- الدرس = سطر في `.agents/memory/lessons.md`: الموقف، الغلط، الصح، ونمط الملفات أو الأوامر اللي بينطبق عليها.
- `PreToolUse` hook يعرض الدروس المطابقة للملف أو الأمر قبل التنفيذ (مرة واحدة لكل درس في الجلسة).
- درس اتكرر في مشروعين يترقّى لـ `~/.agents/lessons.md` ويدخل في `sabry-profile.zip`.
- حد أقصى للحجم، والدروس القديمة اللي ما اتطابقتش من زمان بتتأرشف.

### 3.4 التنسيق بين الـ agents

skill اسمها `kit-orchestrate` (مش agent، لأن الـ subagent مايقدرش يشغّل subagents):

| playbook | التسلسل |
|---|---|
| feature | senior-pm ← cto ← (backend ∥ frontend) ← qa-tester ← code-reviewer |
| bugfix | senior-engineer (سبب جذري) ← إصلاح ← qa-tester |
| فكرة منتج | market-researcher ← senior-pm ← business-analyst ← cto |
| release | devops-sre ∥ security-reviewer ← tech-writer |
| عرض لعميل | business-developer ← proposal-writer |

- كل خطوة بتكتب نتيجتها في ملف handoff واحد، واللي بعدها بيقراه بدل ما يعيد الاستكشاف.
- الخطوات المستقلة بتتشغّل بالتوازي، وكل تقرير له حد طول.
- المهمة الصغيرة (ملف أو اتنين) مابتدخلش orchestration أصلاً.

### 3.5 جودة التنفيذ

- **معيار "خلصت" لكل نوع مهمة** (feature · bugfix · refactor · migration): قايمة قصيرة لازم تتجاوب قبل الإعلان.
- **تغطية المطلوب:** الطلب بيتفكّك لبنود مرقّمة في أول المهمة، وفي الآخر كل بند يتعلّم: اتنفّذ / ما اتنفّذش وليه.
- **مراجعة ذاتية:** أي تغيير أكبر من حد معيّن (سطور أو ملفات) بيعدّي على `code-reviewer` بسياق نضيف قبل "خلصت".
- **قياس:** حالات eval جديدة لكل نقطة، مع الكيت ومن غيره.

### 3.6 المهام الطويلة

- `.agents/plans/<slug>/plan.md`: مراحل بـ checkboxes، ومعيار قبول لكل مرحلة.
- ملخص أول الجلسة يعرض الخطة النشطة وأول بند مش متعلّم.
- `Stop` hook: لو فيه خطة نشطة واتغيّر كود، يطلب تحديث الـ checkboxes.
- `PreCompact` hook: يحفظ الحالة قبل ما الـ context يتضغط، عشان المهمة ماتتوهش بعدها.

### 3.7 الـ agents الجداد

| Agent | الدور |
|---|---|
| `mobile-developer` | React Native / Expo / Flutter: شاشات، navigation، حالات offline، نشر على المتاجر |
| `ai-engineer` | features بالـ LLM: اختيار موديل، prompts، RAG، tool use، evals، تكلفة |
| `delivery-manager` | حالة كذا مشروع، تقدير وقت، مخاطر، تقرير أسبوعي للعميل |
| `proposal-writer` | عروض أسعار، SOW، ردود وتقارير تسليم بلغة وأسلوب كل عميل |

كل واحد: ملف في `agents/` + ملف دور في `Roles/` + صف في جدول التفعيل.

## 4. المراحل

| # | المرحلة | المخرجات | معيار القبول |
|---|---|---|---|
| 1 | الأساس لكل الأدوات: tiers + `kit_install.py` (التعليمات · الـ skills · الـ agents) لـ Codex و Kimi | `providers/*.json` · `tier:` في الـ agents · `hooks/kit_install.py` | اختبارات على HOME مؤقت: تثبيت، إعادة تثبيت من غير تكرار، حفظ محتوى المستخدم، إلغاء تثبيت نضيف |
| 2 | الـ agents الأربعة + دمج 3 أزواج متداخلة | 4 agents + 4 Roles · العدد 19 | frontmatter صالح؛ حالة eval لكل واحد |
| 3 | الدروس | hooks التسجيل والعرض + الترقية | تصحيح في جلسة بيظهر كتنبيه في الجلسة اللي بعدها؛ اختبارات |
| 4 | الخطط الطويلة | plan.md + hooks المتابعة و PreCompact | جلسة جديدة بتكمّل من أول بند مش متعلّم |
| 5 | الـ orchestrator + معايير الجودة | `kit-orchestrate` + playbooks + معيار "خلصت" | حالات eval: feature كاملة بتعدّي بالتسلسل الصح |
| 6 | hooks الكيت في Codex CLI | `~/.codex/hooks.json` مولّد | القواعد المفروضة (commits · أسرار · كومنتات) بتمنع جوه Codex |
| 7 | hooks الكيت في Kimi Code CLI + plugin لـ Kimi | `.kimi-plugin/plugin.json` + `adapt.py kimi` | نفس الشرط، والـ profile بيتحقن مع أول رسالة |
| 8 | توثيق + 0.3.0 | README بالعربي والإنجليزي + جدول "إيه بيشتغل فين" | الروابط سليمة؛ `verify-hooks.py` كله ناجح |

كل مرحلة: اختبارات + `verify-hooks.py` + push على `main` + ملخص.

## 5. مخاطر

| الخطر | التعامل معاه |
|---|---|
| الـ context بيكبر (4 agents + دروس + خطط) | الدروس والخطط بتتعرض عند الحاجة بس، وبحد أقصى. قياس التوكنز قبل وبعد كل مرحلة بالـ evals |
| صيغ Codex و Kimi بتتغيّر بسرعة | التصدير معزول في ملف واحد لكل أداة، واختبار على الملفات المولّدة |
| موديلات أضعف بتتجاهل قواعد | القواعد الحرجة مفروضة بالـ hooks مش بالنص؛ evals لكل مزوّد عند الحاجة |
| كشف التصحيح بيغلط | بيطلب تسجيل درس بس، مابيمنعش حاجة. ومفتاح قفل في الـ profile |

## 6. القرارات

| القرار | الحالة |
|---|---|
| كل أداة لوحدها بالكيت كامل، مش مزوّد جوه أداة تانية | ✅ المالك، 2026-11-14 |
| دمج 3 أزواج agents متداخلة (العدد 19) | ✅ المالك |
| ترتيب المراحل زي الجدول، والتنفيذ مرحلة مرحلة مع مراجعة | ✅ المالك |
| GLM بيتشغّل من أنهي أداة (Codex CLI · OpenCode · غيرهم) | ⏳ مفتوح |
| موديلات كل مستوى في Codex و Kimi | ⏳ مفتوح (الافتراضي: موديل الأداة) |

## 7. اللي مش في الخطة

- تخزين مفاتيح API للمزوّدين جوه الكيت أو الـ profile.
- دعم Gemini CLI و Cursor أكتر من الموجود.
- تشغيل evals على كل مزوّد تلقائياً (محتاج مفاتيح وتكلفة؛ يتعمل يدوي).
