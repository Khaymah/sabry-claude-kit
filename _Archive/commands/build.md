# /build — كتابة كود جديد من الصفر

اكتب كود جديد بصفة Senior Engineer.

**الاستخدام:**
- `/build "API endpoint للمصادقة"` — ابنِ feature كاملة
- `/build "React hook لإدارة الـ form"` — ابنِ utility
- `/build "Docker setup للمشروع"` — ابنِ infra

## القواعد:
- اكتب الكود الكامل — لا `...` أو placeholders
- أضف error handling من السطر الأول
- استخدم TypeScript types/interfaces واضحة
- لا كومنتات في الكود ([comment-discipline](../rules/comment-discipline.md)) — القرارات غير الواضحة تتشرح في الرد أو في `Decisions/`
- قبل "خلصت": typecheck + الاختبارات المتعلقة + lint ([completion-discipline](../rules/completion-discipline.md))
- إذا الطلب غامض، اسأل سؤالاً واحداً محدداً قبل البدء — بـ `AskUserQuestion`

**Arguments:** `$ARGUMENTS`
