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

> 🔒 `enforce-comment-discipline` بيرفض أي كومنت مضاف في JS/TS (الملفات غير الكود مش متأثرة).
