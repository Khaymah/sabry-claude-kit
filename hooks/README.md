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

## 2. كل hook بيعمل إيه

| Hook | الحدث · الـ matcher | بيعمل إيه | بيمنع؟ |
|---|---|---|---|
| `project-storage.py` | SessionStart | يجهّز `.agents/` جوه المشروع ويحوّل الـ memory والخطط والـ agent-memory ليه ويركّب الـ pre-commit (قسم 4) | لا |
| `project-storage.py --save-transcript` | SessionEnd | ينسخ الـ transcript لـ `.agents/sessions/` | لا |
| `inject-rules.py` | SessionStart | يحقن `rules/*.md` في السياق (لو مش محمّلة أصلاً من `~/.claude/rules`) | لا |
| `maintain-note.py` | SessionStart | تذكير مرة في اليوم بالصيانة الأسبوعية | لا |
| `team-review-reminder.py --baseline` | SessionStart | يصوّر حالة الشجرة عشان يفرّق بين شغل الجلسة والتعديلات القديمة | لا |
| `team-review-reminder.py` | Stop | لو كود اتغيّر في الجلسة: يقترح `/team-review` بالـ reviewers المناسبين، مرة واحدة لكل change-set | لا |
| `enforce-commit-style.py` | PreToolUse · `Bash` | يرفض commit أو PR فيه نسبة لـ AI أو رسالة بالعربي (`-m` · heredoc · `-F` · `--amend` · `gh --body-file`) | ✅ |
| `scan-secrets.py` | PreToolUse · `Bash` + git pre-commit | يمنع commit فيه مفتاح أو token أو private key أو `.env` (قسم 5) | ✅ |
| `enforce-comment-discipline.py` | PreToolUse · `Write\|Edit\|MultiEdit` | يرفض إضافة كومنت لملف كود (الاستثناءات: build directives و`IMPORTANT:`) | ✅ |
| `enforce-nextjs-structure.py` | PreToolUse · `Write\|Edit\|MultiEdit` | مشاريع Next.js بس: حد 600 سطر (و300 لـ PageContent)، PascalCase للجديد تحت `src/`، وحالة الحروف متطابقة مع الموجود على القرص | ✅ |
| `warn-duplication.py` | PostToolUse · `Write\|Edit\|MultiEdit` | مشاريع Next.js بس: يرجّع للـ agent كود مكرر عشان يوحّده | يرجّع feedback |
| `run-if-installed.py code-review-graph …` | PreToolUse/PostToolUse | يحدّث الـ code graph لو الأداة متسطّبة | لا |
| `sounds/play.py <wav>` | SessionStart · AskUserQuestion · Stop · StopFailure · PermissionRequest | صوت إشعار | لا |

### سكربتات مساعدة (مش hooks)

| الملف | الاستخدام |
|---|---|
| `verify-hooks.py` | يشغّل كل hook فعلياً بمُدخلات حقيقية ويتأكد من التسجيل في `hooks.json`. شغّله بعد أي تعديل |
| `test_*.py` | اختبارات سلوكية لكل hook مانع |
| `adapt.py` | يشغّل نفس الـ hooks تحت Codex أو Gemini CLI أو Cursor (قسم 7) |
| `graph-doctor.py` | يفحص تغطية `code-review-graph` في كل مشاريعك |
| `kit_config.py` | مكتبة مشتركة: بتقرا الـ profile ومفاتيح التشغيل (`settings`) لكل الـ hooks |

### ليه مفيش hook بيفرض موديل؟

كان فيه `enforce-opus.py` في الـ plugin و`enforce-sonnet.py` في `settings.json`، والاتنين شغالين على نفس الحدث وعكس بعض.
وأي hook بيكتب `model` في استدعاء الـ Agent **بيغلب `model:` اللي في الـ frontmatter**، فكان `enforce-opus` بيلغي `sonnet` في كل الـ agents.
دلوقتي موديل كل agent بيتحدد من ملفه في `agents/`. التفاصيل في [`rules/subagents.md`](../rules/subagents.md).

---

## 3. الأصوات

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

**تقفل الصوت:** `SABRY_KIT_SOUNDS=0` في `env` جوه `settings.json` أو في الـ shell.
**تغيّر صوت:** استبدل الـ `.wav` بنفس الاسم.

---

## 4. التخزين جوه المشروع (`.agents/`)

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
| git pre-commit | بيتركّب لو مفيش pre-commit للمشروع ومفيش `core.hooksPath` (husky مثلاً). غير كده بيسيبه، و`/sabry-kit:doctor` بيقولك |

**تقفله:** `"project_storage": false` في الـ profile، أو `SABRY_KIT_PROJECT_STORAGE=0`. ولو عايز تقفل نسخ الـ transcripts بس: `"keep_transcripts": false`.

> الـ scratchpad بتاع الجلسة مكانه بيحدده Claude Code، و`CLAUDE_CODE_TMPDIR` بيتجاهله من إعدادات المشروع. عشان كده [`rules/project-storage.md`](../rules/project-storage.md) بيوجّه الملفات المؤقتة لـ `.agents/scratch/`.

---

## 5. فحص الأسرار قبل الـ commit

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

## 6. التحقق إنها شغالة

```bash
python3 hooks/verify-hooks.py
```

```bash
for t in hooks/test_*.py; do python3 "$t" >/dev/null && echo "PASS $t" || echo "FAIL $t"; done
```

`verify-hooks.py` بيثبت إن **السكربتات** سليمة ومتسجلة. عشان تتأكد إن Claude Code نفسه بيناديها: افتح جلسة واكتب `/hooks`، وبعدين عدّل أي ملف `.ts` وسيب الدور يخلص، المفروض تشوف سطر `[team-review]`.

تقفل hook مؤقتاً: `/plugin` ← عطّل `sabry-kit`، أو امسح السطر بتاعه من `hooks.json`.

---

## 7. أدوات تانية (Codex · Gemini CLI · Cursor)

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

## 8. إضافة hook جديد

1. سكربت Python تحت `hooks/`: يقرأ JSON من stdin، ويطلع بـ exit 0 في كل حالات الفشل.
2. سجّله في `hooks.json` بنفس شكل الأمر:
   `"$(command -v python3 || command -v python)" "${CLAUDE_PLUGIN_ROOT}/hooks/<name>.py"`
3. لو بيمنع حاجة: اكتب `test_<name>.py` فيه حالة deny وحالة allow مقابلة، وضيف فحص التسجيل في `verify-hooks.py`.
4. ممنوع أي مسار مطلق أو `powershell`؛ `verify-hooks.py` بيفشل لو لقاهم.
5. حدّث الجدول في القسم 2.
