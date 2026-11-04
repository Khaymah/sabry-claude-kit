---
name: kit-doctor
description: يفحص إعداد Claude Code عند المستخدم (الـ plugins والـ skills والـ agents والـ commands والـ hooks والـ settings والـ CLAUDE.md) ويلاقي أي حاجة بتتعارض مع sabry-kit أو مع الـ profile، ويصلّحها بموافقته بس، مع backup وإمكانية الرجوع. استخدمه عند `/sabry-kit:kit-doctor` أو `/kit-doctor`، أو بعد `/sabry-kit:kit-setup`، أو لما الجلسة تنبّه بتعارض، أو لما المستخدم يقول "فيه حاجة بتتعارض" / "نضّف الإعدادات" / "check conflicts".
---

# 🩺 sabry-kit doctor

الهدف: الكيت يبقى العقل الوحيد، من غير تعليمات أو hooks تانية بتشدّه في اتجاه عكسي. **ما تصلّحش أي حاجة من غير موافقة صريحة.**

مجلد الكيت = مجلدين فوق مجلد الـ skill ده (الـ base directory اللي ظاهر لما الـ skill اتحمّل).

## 1. افحص

```bash
python3 "<kit>/hooks/doctor.py" scan --json
```

كل finding فيه: `id` · `severity` (high / medium / low / info) · `title` · `evidence` · `why` · `fix.type`.

## 2. اعرض

جدول واحد مرتّب بالخطورة، كل صف سطر واحد:

| | التعارض | فين | الإصلاح |
|---|---|---|---|
| 🔴 | … | المسار المختصر | تلقائي / يدوي |

- **`manual`** = مفيش إصلاح تلقائي (سطر في CLAUDE.md، pre-commit خاص بالمشروع…). اكتب جنبه الخطوة بالظبط من `why`.
- **مفيش findings** ← قول "✅ مفيش تعارضات" وخلّص.

## 3. اسأل

`AskUserQuestion` واحد، **multiSelect**، بـ 4 خيارات بالكتير:

- لو الـ findings التلقائية ≤ 4: خيار لكل واحد (العنوان + الإصلاح بالظبط + الأثر الجانبي، مثلاً "تعطيل plugin productivity كله، مش الـ skill بس").
- لو أكتر: جمّعهم: "كل الـ 🔴" · "كل الـ 🟠" · "كل الـ 🟡" · "اختار واحد واحد" (وبعدها اسأل جولة تانية).

ما تختارش بالنيابة عنه. لو ما اختارش حاجة ← ما تعملش حاجة.

## 4. صلّح

```bash
python3 "<kit>/hooks/doctor.py" fix <id> <id> ...
```

النتيجة فيها `fixed` و`skipped` وأمر `undo`. بعدها شغّل `scan` تاني واعرض اللي فاضل.

## 5. اقفل

- **اللي اتصلّح:** سطر لكل واحد.
- **اللي فاضل يدوي:** مع الخطوة.
- **الرجوع:** `python3 "<kit>/hooks/doctor.py" undo` بيرجّع آخر تشغيل بالظبط، و`runs` بيعرض التشغيلات اللي ينفع ترجع فيها.
- **plugin اتعطّل:** التعطيل بيتطبّق من الجلسة الجاية. لو الـ plugin متزامن من claude.ai، اتأكد بـ `/plugin` إنه اتقفل.

## إيه اللي بيتفحص

| الفئة | أمثلة |
|---|---|
| الموديل | hook بيكتب `model` على كل Agent · `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` |
| نسخ مكرّرة | نسخة تانية من sabry-kit · `~/.claude/agents|skills|hooks` symlink للكيت · agent أو skill بنفس اسم واحد في الكيت · hooks الكيت متسجلة في settings كمان |
| الذاكرة | auto memory مقفولة · `autoMemoryDirectory` عام · plugins بتدير MEMORY.md/CLAUDE.md بطريقتها · خطط في مسار تاني |
| الـ commits | `attribution` بيضيف توقيع AI · plugin أو CLAUDE.md بيطلب `Co-Authored-By` |
| الـ workflow | plugin بيفرض brainstorm/plan/TDD على كل مهمة |
| التكلفة | `effortLevel` · `autoCompactWindow` · `CLAUDE_CODE_MAX_OUTPUT_TOKENS` أعلى من `cost_profile` · plugins بتحقن context في كل جلسة |
| الأمان | فحص الأسرار مش متركّب بسبب husky أو pre-commit خاص |
| CLAUDE.md | سطور بتطلب كومنتات/JSDoc أو haiku أو توقيع AI |
| أسامي الأوامر | أمر في الكيت بنفس اسم أمر مدمج في Claude Code (زي `/doctor`) أو skill/command في plugin تاني |

قاعدة مقفولة في الـ profile (مثلاً `commit_style: false`) ← التعارضات الخاصة بيها مش بتظهر.
