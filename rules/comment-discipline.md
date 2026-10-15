# انضباط الكومنتات — قاعدة حديدية

**الكود لا يحمل أي كومنت.** لا سطري، لا كتلة، **ولا JSDoc.** الاستثناء الوحيد:
كومنت يبدأ بـ `IMPORTANT:` يوسم شيئاً **فائق الأهمية فعلاً**.

- الكود القابل للقراءة بسهولة **ممنوع مطلقاً** التعليق عليه.
- المبرّرات (الـ why، قرارات التصميم) تُكتب في `Plan/ADR/` و`Plan/` — **لا داخل الكود**.
- لا تكتب كومنت افتراضياً. عند لمس ملف قديم فيه كومنتات ← احذفها، لا تُبقِها.

**مستثنى دائماً** (وظيفي لا توثيقي — حذفه يكسر الكومبايل):
`ts-expect-error` · `ts-ignore` · `ts-nocheck` · `ts-check` · `triple-slash <reference>` ·
`eslint-*` · `prettier-ignore` · `biome-ignore` · `c8/v8/istanbul ignore` · `@jsxImportSource` ·
`@vite-ignore` · `webpackChunkName` · `__PURE__` · `@preserve` · `@license` · `/* global */`.

> 🔒 **مُنفَّذ حتمياً بـ hook, لا اعتماداً على الذاكرة:** `PreToolUse` بـ matcher
> `Write|Edit|MultiEdit` (`hooks/enforce-comment-discipline.py`) يرفض أي تعديل يضيف كومنتاً
> لملف JS/TS إلا الـ directives و`IMPORTANT:`. لا يُفحص إلا النص المُضاف؛ كومنت موجود مسبقاً
> في `old_string` ولم يُلمس لا يُرفض. ملفات غير-الكود (md · json · yaml · py · sh) غير متأثرة.
> الاختبارات في `hooks/test_enforce_comment_discipline.py` (28 حالة) — شغّلها بعد أي تعديل.

هذه تبطل القاعدة الأقدم "احذف غير-JSDoc وأبقِ JSDoc" — الآن **حتى JSDoc يُحذف**.
