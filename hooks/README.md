# 🪝 Hooks — دليل كامل

الـ hooks سكربتات Python بتشتغل تلقائياً في نقاط محددة من دورة الـ agent: قبل أمر shell، قبل تعديل ملف، في أول الجلسة، وفي آخر الدور.
الهدف منها إن القواعد اللي ممكن تتنسي تبقى **مستحيلة المخالفة**، بدل ما تفضل مجرد تعليمة في `CLAUDE.md`.

- **مصدر واحد:** كل الـ hooks متسجلة في [`hooks.json`](hooks.json) بمسارات `${CLAUDE_PLUGIN_ROOT}`، ومفيش ولا hook في `settings.json`. كده مفيش مسار خاص بجهاز، ومفيش hook بيشتغل مرتين.
- **محمولة:** Python 3.8+ بمكتبته القياسية بس، وشغالة على Windows وmacOS وLinux، محلياً أو في السحابة.
- **Fail-open:** أي hook بيقع (payload تالف، أداة مش موجودة، استثناء) بيطلع بـ exit 0 من غير ما يكسر الدور. اللي بيمنع حاجة بيمنعها بقرار صريح (`deny`)، مش بـ crash.

---

## 1. التثبيت

### Claude Code (الطريقة الموصى بها: plugin)

```text
/plugin marketplace add Khaymah/sabry-claude-kit
/plugin install sabry-kit@sabry-kit
```

الـ plugin بيحمّل `hooks/hooks.json` تلقائياً، وClaude Code بيعوّض `${CLAUDE_PLUGIN_ROOT}` بمكان التثبيت على أي جهاز.
اتأكد بـ `/hooks` جوه الجلسة: لازم تشوف الـ hooks تحت مصدر `sabry-kit`.

> ⚠️ **الـ symlinks لوحدها (طريقة 2 في الـ README) مش بتشغّل hooks.** Claude Code مش بيقرأ `~/.claude/hooks/hooks.json`؛ بيقرأ hooks من `settings.json` أو من plugin بس.
> الـ symlinks مفيدة لـ `CLAUDE.md` و`settings.json` و`rules/`، والـ hooks لازم تيجي من الـ plugin.
> لو عامل symlink لـ `settings.json` بتاع الكيت، فهو أصلاً بيعرّف الـ marketplace (`Khaymah/sabry-claude-kit`) وبيفعّل `sabry-kit@sabry-kit`، فالـ plugin بيتسطّب لوحده.

### متطلبات

| المتطلب | ليه | لو مش موجود |
|---|---|---|
| `python3` أو `python` على PATH | كل الـ hooks | الأمر بيجرّب `python3` الأول وبعدين `python` |
| `git` | `enforce-commit-style` (رسائل `--amend` و`-C`) و`team-review-reminder` | الفحص ده بيتخطّى |
| مشغّل صوت (تحت) | الأصوات | صامت |
| `code-review-graph` | تحديث الـ graph | `run-if-installed.py` بيتخطّاه بصمت |

> **Windows:** Claude Code بيشغّل الـ hooks عن طريق Git Bash. لو `python3` بيفتح Microsoft Store بدل ما يشتغل، اقفل الـ alias من
> *Settings ← Apps ← Advanced app settings ← App execution aliases* (`python3.exe`)، أو سطّب Python من python.org.

---

## 2. الـ profile (إعداد أول مرة)

`/sabry-kit:kit-setup` بيسأل 3 جولات أسئلة (الاسم، اللغة، أسلوب الرد، وضع العمل، الـ stack، التكلفة مقابل الجودة، القواعد اللي تتفرض) ويحفظ:

| الملف | فيه إيه | بيتحقن؟ |
|---|---|---|
| `~/.agents/profile.json` | الإجابات + مفاتيح التشغيل (`settings`) | ✅ ملخص صغير في **أول** الـ context بأولوية قصوى |
| `~/.agents/profile.md` | سياق شخصي حر (أهداف، قيود، عملاء) | ❌ مسار بس؛ الـ agents بتقراه عند القرارات الاستراتيجية |
| `<project>/.agents/profile.json` | override لمشروع واحد بنفس الشكل | بيتدمج فوق العام |

- **الترتيب:** `DEFAULTS` < profile المالك < `<project>/.agents/profile.json` < متغيرات `SABRY_KIT_<KEY>`.
- **profile المالك:** الأحدث (بحقل `updated`) بين `~/.agents/profile.json` والـ skill `sabry-profile` المتزامنة من claude.ai (`kit_profile.py bundle` بيبنيها zip للرفع)، وإلا `SABRY_KIT_PROFILE_JSON` كاحتياطي.
- **لسه ما اتعملش؟** `inject-rules` بيحط سطر بيقترح `/sabry-kit:kit-setup` مكان الـ profile.
- **قاعدة مقفولة = مش بتتحقن أصلاً** (توفير توكنز)، والـ hook بتاعها بيسكت.
- **من الـ CLI:** `python3 hooks/kit_profile.py show | set '<json>' | set --project '<json>' | context '<md>' | render`.

| المفتاح (`settings`) | الافتراضي | بيتحكم في |
|---|---|---|
| `commit_style` | ✅ | `enforce-commit-style` |
| `git_identity` | ✅ | `git-identity`: يحط اسم المالك وإيميله (`git_name` · `git_email` في الـ profile) على git أول الجلسة |
| `git_signing` | ✅ | `git-signing`: يوقّع الـ commits بمفتاح المالك من `SABRY_SIGNING_KEY` في كل جلسة |
| `comment_discipline` | ✅ | `enforce-comment-discipline` + قاعدتها |
| `nextjs_structure` · `duplication_warning` | ✅ | hooks الـ Next.js |
| `secret_scan` · `install_git_hook` | ✅ | `scan-secrets` + الـ git pre-commit |
| `project_storage` · `keep_transcripts` | ✅ | `project-storage` + قاعدتها |
| `team_review_reminder` | ✅ | `team-review-reminder` |
| `sounds` | ✅ | `sounds/play.py` |
| `deal_economics` | ❌ | قاعدة Freelancer-Trap |
| `usage_meter` | ✅ | `usage.py record` |
| `read_budget` · `read_budget_lines` | ✅ · `800` | `read-budget` وحدّه بالسطور |
| `verify_reminder` | ✅ | `verify-reminder` |
| `project_brief` | ✅ | ملخص المشروع في أول الجلسة |
| `lessons` | ✅ | `lessons`: تسجيل تصحيحات المالك وعرضها في الجلسات اللي بعدها |
| `long_task_plans` | ✅ | `kit_plans`: خطة المهمة الطويلة في الملخص + تذكير الـ checkboxes + حفظ الحالة قبل الـ compaction |

---

## 3. كل hook بيعمل إيه

| Hook | الحدث · الـ matcher | بيعمل إيه | بيمنع؟ |
|---|---|---|---|
| `project-storage.py` | SessionStart | يجهّز `.agents/` جوه المشروع ويحوّل الـ memory والخطط والـ agent-memory ليه ويركّب الـ pre-commit (قسم 5) | لا |
| `project-storage.py --collect` | Stop · SessionEnd | يرجّع الذاكرة والخطط الجديدة لـ `.agents/`، وفي السحابة يفكّر بـ commit و push | feedback |
| `project-storage.py --save-transcript` | SessionEnd | ينسخ الـ transcript لـ `.agents/sessions/` | لا |
| `doctor.py brief` | SessionStart | مرة في اليوم: لو فيه تعارض خطير مع الكيت بيظهر للمستخدم سطر يقترح `/sabry-kit:kit-doctor` | لا |
| `project-brief.py` | SessionStart | ملخص صغير (≤1.5KB) من غير موديل: الـ stack من الـ manifests، وأوامر test/typecheck/lint/build، والفولدرات، وحالة git، و"الجاي/مفتوح" من آخر `Plan/Progress` | لا |
| `git-identity.py` | SessionStart | لو هوية git فاضية أو AI (زي `Claude <noreply@anthropic.com>` في جلسات الكلاود): يحط `git_name`/`git_email` من الـ profile، ومابيلمسش هوية شخص حقيقي أبداً. ولو الـ profile مفيهوش هوية، بيطلب من الـ agent يسأل المالك | لا |
| `git-signing.py` | SessionStart | بيوقّع الـ commits بمفتاحك. المفتاح بيتقري من **الـ profile** (`~/.agents/signing_key`، أو `signing_key` جوه skill `sabry-profile` المتزامنة من claude.ai) فبيوصل لكل جهاز وكل بيئة من غير إعداد، وإلا من `SABRY_SIGNING_KEY`. لو `ssh-keygen` مش موجود في جلسة سحابية بيسطّبه لوحده. المفتاح عمره ما بيتطبع، الـ fingerprint بس | لا |
| `inject-rules.py --late` | UserPromptSubmit | لو الجلسة بدأت قبل ما الـ profile يتزامن من claude.ai: يحقنه مع أول رسالة، مرة واحدة | لا |
| `inject-rules.py --part 1..4` | SessionStart | يحقن الـ profile و `rules/*.md` في السياق (لو مش محمّلة أصلاً من `~/.claude/rules`). متقسّم على 4 نداءات لأن Claude Code بيقصّ أي ناتج hook فوق 10,000 حرف لأول 2,000 بس | لا |
| `maintain-note.py` | SessionStart | تذكير مرة في اليوم بالصيانة الأسبوعية | لا |
| `team-review-reminder.py --baseline` | SessionStart | يصوّر حالة الشجرة عشان يفرّق بين شغل الجلسة والتعديلات القديمة | لا |
| `team-review-reminder.py` | Stop | لو كود اتغيّر في الجلسة: يقترح `/team-review` بالـ reviewers المناسبين، مرة واحدة لكل change-set | لا |
| `enforce-commit-style.py` | PreToolUse · `Bash` + أدوات GitHub/GitLab في الـ MCP | يرفض أي نسبة لـ AI في الـ commits والـ tags والـ PRs والـ issues والتعليقات والـ reviews والـ releases (`Co-Authored-By` لأي أداة AI · `Generated with/by …` بأي صيغة · روابط `claude.ai/code/session_` · `Claude-Session:` · 🤖)، عبر `git` و`gh` و`gh api` و`glab` والـ MCP. ويرفض العربي في رسائل الـ commit وعناوين ووصف الـ PR، **أو commit صاحبه أو الـ committer بتاعه Claude/Anthropic** (`--author` · `GIT_AUTHOR_*` · `git -c user.*` · `git config` · `--amend` من غير `--reset-author`) | ✅ |
| `scan-secrets.py` | PreToolUse · `Bash` + git pre-commit | يمنع commit فيه مفتاح أو token أو private key أو `.env` (قسم 6) | ✅ |
| `enforce-comment-discipline.py` | PreToolUse · `Write\|Edit\|MultiEdit` | يرفض إضافة كومنت لملف كود (الاستثناءات: build directives و`IMPORTANT:`) | ✅ |
| `enforce-nextjs-structure.py` | PreToolUse · `Write\|Edit\|MultiEdit` | مشاريع Next.js بس: حد 600 سطر (و300 لـ PageContent)، PascalCase للجديد تحت `src/`، وحالة الحروف متطابقة مع الموجود على القرص | ✅ |
| `warn-duplication.py` | PostToolUse · `Write\|Edit\|MultiEdit` | مشاريع Next.js بس: يرجّع للـ agent كود مكرر عشان يوحّده | يرجّع feedback |
| `read-budget.py` | PreToolUse · `Read` | يرفض قراءة ملف نصي أكبر من 800 سطر كله من غير `offset`/`limit`، ويوجّه لـ Grep + مدى محدد. `limit` صريح = مسموح | ✅ |
| `verify-reminder.py` | Stop | لو اتعدّل كود ومفيش test/typecheck/lint/build اشتغل بعد آخر تعديل: يطلب التحقق (بأوامر المشروع نفسه من `package.json`) أو يقول إيه اللي ما اتحققش. مرة لكل change-set | feedback |
| `lessons.py --prompt` | UserPromptSubmit | أول رسالة في الجلسة: يعرض الدروس العامة. رسالة شكلها تصحيح ("غلط" · "قلتلك" · "مش كده" · "wrong" · "I told you"): يطلب من الـ agent يسجّل درس بـ `lessons.py add` | لا |
| `lessons.py --start` | SessionStart | يعرض الدروس العامة أول الجلسة. بعد compact أو `/clear` بينسى اللي عرضه قبل كده، فالدروس العامة ترجع فوراً والمحددة بملف أو أمر تظهر تاني عند أول تطابق | لا |
| `lessons.py --match` | PreToolUse · `Bash\|Write\|Edit\|MultiEdit` | يعرض الدروس اللي نمطها (`files` globs · `commands`) مطابق للملف أو الأمر، مرة واحدة لكل درس في الجلسة | لا |
| `kit_plans.py --stop` | Stop | فيه خطة نشطة في `.agents/plans/<slug>/plan.md` واتعدّلت ملفات بعد آخر تحديث ليها: يطلب تعليم البنود اللي خلصت (مرة لكل تغيير) | لا |
| `kit_plans.py --precompact` | PreCompact | يحفظ مكان الخطة، الملفات المتعدّلة وغير المتسجّلة، وآخر رسائل المالك في `~/.agents/state/` | لا |
| `kit_plans.py --start` | SessionStart (بعد compaction بس) | يرجّع الحالة المحفوظة للـ context عشان المهمة تكمّل من مكانها | لا |
| `usage.py record` | SessionEnd | يسجّل استهلاك الجلسة (input · cache · output · الأدوات · الـ subagents) في `.agents/sessions/usage.jsonl`. العرض: `/sabry-kit:kit-stats` | لا |
| `run-if-installed.py code-review-graph …` | PreToolUse/PostToolUse | يحدّث الـ code graph لو الأداة متسطّبة | لا |
| `sounds/play.py <wav>` | SessionStart · AskUserQuestion · Stop · StopFailure · PermissionRequest | صوت إشعار | لا |

### سكربتات مساعدة (مش hooks)

| الملف | الاستخدام |
|---|---|
| `verify-hooks.py` | يشغّل كل hook فعلياً بمُدخلات حقيقية ويتأكد من التسجيل في `hooks.json`. شغّله بعد أي تعديل |
| `test_*.py` | اختبارات سلوكية لكل hook مانع |
| `adapt.py` | يشغّل نفس الـ hooks تحت Codex أو Gemini CLI أو Cursor (قسم 8) |
| `graph-doctor.py` | يفحص تغطية `code-review-graph` في كل مشاريعك |
| `kit_config.py` | مكتبة مشتركة: بتقرا الـ profile ومفاتيح التشغيل (`settings`) لكل الـ hooks |
| `kit_profile.py` | CLI الـ profile (قسم 2) |
| `usage.py` | `report` · `report --current` · `report --json`: فين التوكنز راحت (الـ skill `/sabry-kit:kit-stats`) |
| `doctor.py` | `scan` · `fix <id>` · `fix --all-safe` · `undo` · `runs`: فحص التعارضات وإصلاحها بـ backup (الـ skill `/sabry-kit:kit-doctor` بيستخدمه) |

### ليه مفيش hook بيفرض موديل؟

كان فيه `enforce-opus.py` في الـ plugin و`enforce-sonnet.py` في `settings.json`، والاتنين شغالين على نفس الحدث وعكس بعض.
وأي hook بيكتب `model` في استدعاء الـ Agent **بيغلب `model:` اللي في الـ frontmatter**، فكان `enforce-opus` بيلغي `sonnet` في كل الـ agents.
دلوقتي موديل كل agent بيتحدد من ملفه في `agents/`. التفاصيل في [`rules/subagents.md`](../rules/subagents.md).

---

## 4. الأصوات

| الحدث | الملف |
|---|---|
| بداية جلسة | `notification.wav` |
| الـ agent بيسألك (`AskUserQuestion`) | `question.wav` |
| الـ agent محتاج إذن | `needs-input.wav` |
| خلّص الدور | `done.wav` |
| الدور فشل | `error.wav` |

`sounds/play.py` بيلاقي الملف جنبه مهما كان مكان التثبيت، وبيستخدم اللي موجود في النظام:

| النظام | المشغّل |
|---|---|
| Windows | `winsound` (من Python نفسه، مش محتاج PowerShell) |
| macOS | `afplay` |
| Linux | أول واحد موجود من: `paplay` · `pw-play` · `aplay` · `ffplay` |

**بيسكت تلقائياً** في جلسة Claude Code السحابية (`CLAUDE_CODE_REMOTE`)، وفي CI، ولو مفيش مشغّل، ولو الملف مش موجود.

**تقفل الصوت:** `"sounds": false` في الـ profile، أو `SABRY_KIT_SOUNDS=0`.
**تغيّر صوت:** استبدل الـ `.wav` بنفس الاسم.

---

## 5. التخزين جوه المشروع (`.agents/`)

كل مشروع بيشيل ذاكرته بنفسه، بعيد عن الجهاز ونسخة الـ plugin والأداة. لو شلت الكيت، مفيش حاجة بتضيع.

```text
.agents/
  memory/        auto memory (MEMORY.md + topic files)   ✅ git
  agent-memory/  ذاكرة الـ subagents                       ✅ git
  plans/         خطط plan mode                             ✅ git
  scratch/       ملفات مؤقتة                               ❌ (.agents/.gitignore)
  sessions/      نسخ الـ transcripts                       ❌ (.agents/.gitignore)
  profile.json   (اختياري) إعدادات خاصة بالمشروع فوق الـ profile العام
  secrets-allowlist  (اختياري) regex لكل false positive في فحص الأسرار
```

`project-storage.py` بيعمل الآتي في أول كل جلسة، وبيعدّي لو كان معمول قبل كده:

| الخطوة | التفاصيل |
|---|---|
| الفولدرات + `.agents/.gitignore` | `scratch/` و`sessions/` بس اللي برّه git |
| `autoMemoryDirectory` + `plansDirectory` | في `.claude/settings.local.json` (Claude Code بيقبل مسار مطلق بس للذاكرة، فده ملف محلي لكل جهاز). باقي المفاتيح بتفضل زي ما هي. **بيشتغل من الجلسة اللي بعدها** |
| `.claude/agent-memory` ← `.agents/agent-memory` | symlink، أو junction على Windows من غير admin. لو كان فولدر حقيقي، محتواه بيتنقل الأول، ولو فيه ملف بنفس الاسم بيتحفظ الاتنين |
| الذاكرة القديمة | `~/.claude/projects/<slug>/memory/` بتتنسخ مرة واحدة لو `.agents/memory/` فاضي. الأصل بيفضل زي ما هو |
| `.git/info/exclude` | الـ link و`settings.local.json` بس. مفيش ملف tracked في المشروع بيتعدّل |
| git pre-commit | بيتركّب لو مفيش pre-commit للمشروع ومفيش `core.hooksPath` (husky مثلاً). غير كده بيسيبه، و`/sabry-kit:kit-doctor` بيقولك |

**تقفله:** `"project_storage": false` في الـ profile، أو `SABRY_KIT_PROJECT_STORAGE=0`. ولو عايز تقفل نسخ الـ transcripts بس: `"keep_transcripts": false`.

> الـ scratchpad بتاع الجلسة مكانه بيحدده Claude Code، و`CLAUDE_CODE_TMPDIR` بيتجاهله من إعدادات المشروع. عشان كده [`rules/project-storage.md`](../rules/project-storage.md) بيوجّه الملفات المؤقتة لـ `.agents/scratch/`.

### في السحابة

جلسات Claude Code السحابية بتتجاهل `settings.local.json` وبتبدأ بـ HOME جديد، فـ `autoMemoryDirectory` و`plansDirectory` مش بيتطبّقوا هناك. عشان كده:

| الخطوة | متى |
|---|---|
| نسخ `.agents/memory` لمكان الذاكرة الافتراضي | SessionStart، في السحابة (ومحلياً في أول جلسة بس قبل ما الإعداد يشتغل) |
| `project-storage.py --collect`: رجوع الذاكرة الجديدة لـ `.agents/memory`، والخطط الجديدة من `~/.claude/plans` لـ `.agents/plans` | Stop و SessionEnd |
| تذكير بـ commit و push لـ `.agents/` | Stop في السحابة، مرة لكل مجموعة تغييرات |

محلياً بعد ما الإعداد يشتغل مفيش مزامنة، عشان ذاكرة اتمسحت عن قصد ماترجعش من النسخة القديمة. الـ profile في السحابة: متغيّر `SABRY_KIT_PROFILE_JSON` (JSON) بيتقري لو مفيش `~/.agents/profile.json`.

---

## 6. فحص الأسرار قبل الـ commit

الذاكرة بقت بتدخل git، فأي agent ممكن يلزق token في ملاحظة. `scan-secrets.py` بيقف قدام ده في مكانين بنفس القواعد:

- **git pre-commit:** بيتنسخ في `.git/hooks/` (stdlib بس) فبيشتغل مع أي أداة أو أي شخص بيعمل commit، حتى من غير الكيت.
- **Claude Code `PreToolUse`:** أي أمر `git commit` (ومعاه `-a`) بيتفحص قبل ما يتنفّذ، والـ agent بياخد السبب عشان يصلّح.

بيفحص **السطور المضافة بس** (سر قديم في الـ history مش هيوقف كل commit بعده):
مفاتيح AWS وGitHub وGitLab وAnthropic وOpenAI وGoogle وSlack وStripe وTwilio وSendGrid وnpm، وprivate keys، وJWT، وباسورد جوه URL، وأي `password`/`secret`/`api_key`/`token` بقيمة حقيقية (بيتجاهل placeholders زي `changeme` و`${VAR}` و`process.env`)، وملفات `.env` و`*.pem` و`id_rsa` (مسموح `.env.example`).
القيم بتظهر **masked** في الرسالة.

| عايز | تعمل |
|---|---|
| false positive في سطر | حط `allow-secret` على السطر |
| false positive متكرر | regex في `.agents/secrets-allowlist` |
| تعدّي commit واحد عن قصد | `git commit --no-verify` |
| تفحص كل الملفات المتتبَّعة | `python3 hooks/scan-secrets.py --all-tracked` |
| تقفله | `"secret_scan": false` (أو `"install_git_hook": false` للـ git hook بس) |

---

## 7. التحقق إنها شغالة

```bash
python3 hooks/verify-hooks.py
```

```bash
for t in hooks/test_*.py; do python3 "$t" >/dev/null && echo "PASS $t" || echo "FAIL $t"; done
```

`verify-hooks.py` بيثبت إن **السكربتات** سليمة ومتسجلة. عشان تتأكد إن Claude Code نفسه بيناديها: افتح جلسة واكتب `/hooks`، وبعدين عدّل أي ملف `.ts` وسيب الدور يخلص، المفروض تشوف سطر `[team-review]`.

تقفل hook مؤقتاً: `/plugin` ← عطّل `sabry-kit`، أو امسح السطر بتاعه من `hooks.json`.

---

## 8. أدوات تانية (Codex · Gemini CLI · Cursor)

> **التثبيت الكامل** (تعليمات + skills + agents + hooks) في Codex و Kimi، ومن غير hooks في OpenCode و Kilo Code و Cline: `kit_install.py --target <codex|kimi|opencode|kilo|cline>`، وشرحه في [README](../README.md#codex-cli-و-kimi-code-cli-كل-أداة-لوحدها). القسم ده عن تسجيل الـ hooks بإيدك عن طريق `adapt.py`.

السكربتات مكتوبة بلغة الـ hooks بتاعة Claude Code. `adapt.py` بيترجم في الاتجاهين، فنفس القواعد بتشتغل في كل أداة من غير ما نعمل نسخة لكل واحدة:

```bash
python3 ~/sabry-claude-kit/hooks/adapt.py <codex|gemini|cursor> <script> [args]
```

في الأمثلة تحت `~/sabry-claude-kit` هو مكان نسخة الكيت عندك؛ غيّره لو مختلف.

### ماذا يعمل أين

| Hook | Claude Code | Codex | Gemini CLI | Cursor |
|---|---|---|---|---|
| `enforce-commit-style` | ✅ | ✅ | ✅ | ✅ |
| `scan-secrets` | ✅ | ✅ | ✅ | ✅ (والـ git pre-commit شغال في أي أداة) |
| `project-storage` | ✅ | ✅ (`SessionStart`) | ✅ | ✅ |
| `enforce-comment-discipline` | ✅ | ⚠️ لا (Codex بيعدّل بـ `apply_patch`) | ✅ (`write_file` · `replace`) | ⚠️ لا (`afterFileEdit` مش بيقدر يمنع) |
| `enforce-nextjs-structure` | ✅ | ⚠️ لا | ✅ | ⚠️ لا |
| `inject-rules` | ✅ | ✅ | ✅ | ✅ (`additional_context`) |
| الأصوات | ✅ | ✅ | ✅ | ✅ |
| `team-review-reminder` | ✅ | ⚠️ لا (Codex مش بيوثّق `additionalContext` على Stop) | — | — |

### Codex CLI

Codex بيقرأ نفس شكل `hooks.json` ونفس مخرجات `PreToolUse`، فـ`adapt.py codex` مجرد pass-through.
الـ hooks مفعّلة افتراضياً، ومحتاجة مراجعة وموافقة من `/hooks` جوه Codex أول مرة. الملف: `~/.codex/hooks.json`:

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "python3 ~/sabry-claude-kit/hooks/inject-rules.py" }] }
    ],
    "PreToolUse": [
      { "matcher": "Bash", "hooks": [{ "type": "command", "command": "python3 ~/sabry-claude-kit/hooks/enforce-commit-style.py", "timeout": 10 }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "python3 ~/sabry-claude-kit/sounds/play.py done.wav" }] }
    ],
    "PermissionRequest": [
      { "hooks": [{ "type": "command", "command": "python3 ~/sabry-claude-kit/sounds/play.py needs-input.wav" }] }
    ]
  }
}
```

### Gemini CLI

الملف: `~/.gemini/settings.json`. أسماء الأدوات مختلفة (`run_shell_command` · `write_file` · `replace`) و`timeout` بالـ milliseconds:

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "python3 ~/sabry-claude-kit/hooks/adapt.py gemini inject-rules.py" }] }
    ],
    "BeforeTool": [
      { "matcher": "run_shell_command", "hooks": [{ "type": "command", "command": "python3 ~/sabry-claude-kit/hooks/adapt.py gemini enforce-commit-style.py", "timeout": 10000 }] },
      { "matcher": "write_file|replace", "hooks": [
        { "type": "command", "command": "python3 ~/sabry-claude-kit/hooks/adapt.py gemini enforce-comment-discipline.py", "timeout": 10000 },
        { "type": "command", "command": "python3 ~/sabry-claude-kit/hooks/adapt.py gemini enforce-nextjs-structure.py", "timeout": 10000 }
      ] }
    ],
    "AfterAgent": [
      { "hooks": [{ "type": "command", "command": "python3 ~/sabry-claude-kit/sounds/play.py done.wav" }] }
    ],
    "Notification": [
      { "hooks": [{ "type": "command", "command": "python3 ~/sabry-claude-kit/sounds/play.py needs-input.wav" }] }
    ]
  }
}
```

### Cursor

الملف: `~/.cursor/hooks.json` (أو `.cursor/hooks.json` في المشروع). Cursor بيعتبر أي مخرجات فاضية من hook إذن كأنها **رفض**، فـ`adapt.py cursor` دايماً بيطبع `{"permission": "allow"}` لما مفيش مخالفة:

```json
{
  "version": 1,
  "hooks": {
    "sessionStart": [
      { "command": "python3 ~/sabry-claude-kit/hooks/adapt.py cursor inject-rules.py" }
    ],
    "beforeShellExecution": [
      { "command": "python3 ~/sabry-claude-kit/hooks/adapt.py cursor enforce-commit-style.py", "timeout": 10 }
    ],
    "stop": [
      { "command": "python3 ~/sabry-claude-kit/sounds/play.py done.wav" }
    ]
  }
}
```

### أدوات من غير hooks

أي أداة بتقرأ ملف تعليمات (`AGENTS.md` · `.github/copilot-instructions.md` · `.windsurfrules`) تقدر تاخد القواعد نفسها من `CLAUDE.md` و`rules/`، بس من غير التنفيذ الإجباري.
اختبار `enforce-commit-style.py` في الـ CI بيغطّي ده: شغّله على رسالة الـ commit كـ `commit-msg` git hook.

> مصادر صيغ الأدوات التانية (اتراجعت 2026-11): [Codex hooks](https://learn.chatgpt.com/docs/hooks) · [Gemini CLI hooks](https://geminicli.com/docs/hooks/reference/) · [Cursor hooks](https://cursor.com/docs/hooks).
> الصيغ دي بتتغيّر بسرعة؛ لو حاجة اتكسرت ابدأ من `adapt.py` (دالتين: `to_claude` و`from_claude`).

---

## 9. إضافة hook جديد

1. سكربت Python تحت `hooks/`: يقرأ JSON من stdin، ويطلع بـ exit 0 في كل حالات الفشل.
2. سجّله في `hooks.json` بنفس شكل الأمر:
   `"$(command -v python3 || command -v python)" "${CLAUDE_PLUGIN_ROOT}/hooks/<name>.py"`
3. لو بيمنع حاجة: اكتب `test_<name>.py` فيه حالة deny وحالة allow مقابلة، وضيف فحص التسجيل في `verify-hooks.py`.
4. ممنوع أي مسار مطلق أو `powershell`؛ `verify-hooks.py` بيفشل لو لقاهم.
5. حدّث الجدول في القسم 2.
