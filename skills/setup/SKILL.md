---
name: setup
description: إعداد أول مرة لـ sabry-kit - أسئلة قليلة عن المستخدم (الاسم، اللغة، أسلوب الرد، وضع العمل، الـ stack، التكلفة مقابل الجودة، القواعد اللي تتفرض) وبتتحفظ كـ profile بأولوية قصوى فوق كل القواعد في كل جلسة. استخدمه عند `/sabry-kit:setup`، أو لما الجلسة تقول إن الإعداد لسه ما اتعملش، أو لما المستخدم يقول "غيّر إعداداتي" / "change my preferences" / "reset setup".
---

# ⚙️ sabry-kit setup

الهدف: profile صغير يتحقن في أول كل جلسة ويغلب أي قاعدة تانية. **دقيقتين بالكتير**: 3 جولات أسئلة، كل جولة `AskUserQuestion` واحدة بـ 4 أسئلة بالكتير.

## 0. اعرف الوضع الحالي

مجلد الكيت = مجلدين فوق مجلد الـ skill ده (الـ base directory اللي ظاهر لما الـ skill اتحمّل). شغّل:

```bash
python3 "<kit>/hooks/kit_profile.py" show
```

- `exists: true` ← ده تعديل مش إعداد جديد: اعرض الإعدادات الحالية في جدول صغير، واسأل بس عن اللي عايز يغيّره.
- فيه `PersonalContext.md` قديم (في `~/.claude/` أو في مجلد الكيت) فيه سياق شخصي حقيقي مش template؟ اعرض استيراده كأول خيار في الجولة 3.
- خُد الاسم المقترح من `git config user.name` لو موجود.

## 1. الجولة الأولى — التواصل

`AskUserQuestion` بالأسئلة دي (العربي افتراضي؛ لو المستخدم كتب بالإنجليزي اسأل بالإنجليزي):

| السؤال | الخيارات (التوصية أولاً) | المفتاح |
|---|---|---|
| أناديك بإيه؟ | `<اسم git>` · من غير اسم | `name` (الكتابة الحرة عن طريق "Other") |
| لغة المحادثة والمستندات؟ | العربية بالمصري · العربية الفصحى · English | `language`: `ar-eg` · `ar` · `en` |
| أسلوب الرد؟ | مختصر ومباشر · متوسط · مفصّل | `verbosity`: `concise` · `balanced` · `detailed` |
| دورك؟ | Solo / freelancer · مطوّر في فريق · Tech lead / CTO · مش تقني | `role` (نص) |

## 2. الجولة التانية — طريقة الشغل

| السؤال | الخيارات | المفتاح |
|---|---|---|
| وضع العمل الافتراضي؟ | CTO + PM: خطط وراجع ولا كود إلا بإذن · تنفيذ مباشر | `mode`: `cto-pm` · `direct` |
| لما الطلب غامض؟ | اسألني بخيارات · افترض وكمّل واكتب الافتراضات | `questions`: `ask` · `assume` |
| التكلفة مقابل الجودة؟ | متوازن · اقتصادي · أقصى جودة | `cost_profile`: `balanced` · `economy` · `max` |
| الـ stack لمشروع جديد؟ | Bun · Hono · Drizzle · PostgreSQL · Next.js · Node · Express · React · Python · FastAPI · حسب كل مشروع | `stack` (نص؛ "حسب كل مشروع" = ما تكتبوش) |

## 3. الجولة التالتة — القواعد والتخزين

| السؤال | الخيارات | المفتاح |
|---|---|---|
| القواعد اللي تتفرض بالـ hooks؟ (**multiSelect**) | commits بالإنجليزي وبلا توقيع AI · فحص الأسرار قبل الـ commit · كود بلا كومنتات · هيكل Next.js + تحذير التكرار | `settings.commit_style` · `secret_scan` · `comment_discipline` · `nextjs_structure` + `duplication_warning` (اللي ما اتختارش = `false`) |
| ذاكرة المشروع؟ | جوه المشروع في `.agents/` وبتدخل git · افتراضي Claude Code (`~/.claude`) | `settings.project_storage` |
| حاجات تانية؟ (**multiSelect**) | أصوات الإشعارات · نسخ الـ transcripts في `.agents/sessions/` · تذكير team review بعد تعديل كود · تنبيه Freelancer-Trap في الصفقات | `sounds` · `keep_transcripts` · `team_review_reminder` · `deal_economics` |
| سياق شخصي؟ | أكتبه دلوقتي (أهداف، قيود، استضافة مفضّلة…) · استورد PersonalContext.md (لو لقيته) · لأ | `profile.md` |

## 4. احفظ

جمّع الإجابات في JSON واحد واحفظه. ممنوع تعدّل الملف بإيدك:

```bash
python3 "<kit>/hooks/kit_profile.py" set '{"name":"…","language":"ar-eg","verbosity":"concise","role":"…","mode":"cto-pm","questions":"ask","cost_profile":"balanced","stack":"…","settings":{"commit_style":true,"secret_scan":true,"comment_discipline":true,"nextjs_structure":true,"duplication_warning":true,"project_storage":true,"sounds":true,"keep_transcripts":true,"team_review_reminder":true,"deal_economics":false}}'
```

- سياق شخصي: `python3 "<kit>/hooks/kit_profile.py" context "<markdown>"`. خليه مختصر ومنظّم بعناوين؛ ده بيتقري عند القرارات الاستراتيجية بس.
- **إعداد خاص بمشروع واحد** (لو المستخدم طلب ده): نفس الأمر بـ `set --project`، بيتكتب في `<project>/.agents/profile.json` ويغلب العام في المشروع ده بس.
- **الاستضافة** لو ذكرها: `"hosting": "…"`. **ملاحظات** إضافية مهمة: `"notes": ["…"]`.

## 5. اقفل

1. اعرض اللي اتحفظ بـ `python3 "<kit>/hooks/kit_profile.py" render` (ده بالظبط اللي هيتحقن).
2. قول بسطر: بيشتغل من **الجلسة الجاية**، والتعديل في أي وقت بـ `/sabry-kit:setup`.
3. اقترح `/sabry-kit:doctor` عشان يفحص أي plugin أو skill أو agent متعارض مع الإعدادات دي.

## قواعد

- ما تسألش عن حاجة تقدر تعرفها (اسم git، الـ stack من `package.json` للمشروع الحالي كاقتراح).
- كل خيار معاه وصف trade-off قصير، والتوصية أول خيار ومكتوب جنبها "(توصية)".
- المستخدم قال "سيبه افتراضي" ← احفظ الافتراضي وما تعيدش السؤال.
- أسرار أو باسوردات في السياق الشخصي ← ما تحفظهاش، وقول ليه.
