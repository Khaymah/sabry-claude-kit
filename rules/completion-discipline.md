# قبل الإعلان عن الانتهاء (TypeScript)

- Client (Next.js): `bun run typecheck` · Server (Bun/Hono): `bun tsc --noEmit`
- عام: `bunx tsc --noEmit --skipLibCheck`
- **مهمة 3+ ملفات:** batch أول ← typecheck ← أكمل. لا تراكم أخطاء.

## Scope — 3+ ملفات

قبل البدء: اذكر بالاسم كل ملف ستعدّله. إن اكتشفت ملفاً آخر يحتاج تعديل ← أبلغ أولاً.
لا تضف ملفات لم تُطلب حتى لو "منطقية".
