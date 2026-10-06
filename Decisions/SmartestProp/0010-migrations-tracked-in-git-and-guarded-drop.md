# ADR-0010: Migrations — SQL Tracked in Git, Migrate on Deploy, Guarded db:drop, Checksum Gate

- **Status:** Accepted
- **Date:** 2026-09-04
- **Deciders:** Sabry
- **Project:** SmartestProp
- **Tags:** database, migrations, deploy, safety
- **Related findings:** SEV-S-009 · SEV-S-010 · SEV-S-101 (Plans/Audit-2026-09-03)

## Context

- `Server/.gitignore` يتجاهل `Src/Database/Migrations/*.sql` بينما مسار النشر يفترض وجودها؛ النتيجة: 9 ملفات محلية فقط على جهاز واحد، ولا يمكن لأي بيئة أخرى إعادة بناء المخطط تاريخياً.
- `Scripts/DropTables.ts` (`db:drop`) يمسح المخطط كاملاً **ويحذف ملفات المهاجرات المحلية** بلا أي حارس بيئة أو تأكيد.
- `Scripts/SystemSettings/BackfillValueTypes.ts` يستبدل القيم غير القابلة للفك بالقيمة الافتراضية بصمت ولا يُبطل كاش Redis — سكربت بيانات بلا إيصال.
- درس Est8Core: «migrations تُنفَّذ فعلاً وتُتبَّع» و«بوابة checksum للمهاجرات» و«كتابة بلا إيصال لا نصف ثانٍ لها».

القيود: Drizzle 0.45 + drizzle-kit؛ نشر على VPS بـ PM2 بلا Docker؛ لا بيئة staging منفصلة موثّقة.

## Decision

1. **التتبّع:** إزالة تجاهل `Src/Database/Migrations/*.sql` و`meta/*` من `.gitignore`؛ الملفات الحالية تُلتزم بعد التأكد (بـ `drizzle-kit check` + مقارنة `__drizzle_migrations` في الإنتاج) أنها تطابق المخطط المنشور.
2. **التوليد في التطوير فقط:** `drizzle-kit generate` يُنتج SQL يُراجَع في الـ PR؛ `drizzle-kit push` ممنوع خارج قاعدة تطوير محلية (بوابة CI تفشل عند وجوده في سكربتات النشر).
3. **التطبيق عند النشر:** `bun run db:migrate` خطوة إلزامية في سكربت النشر قبل `pm2 reload`؛ فشلها يوقف النشر.
4. **`db:drop` محروس:** يرفض عند `NODE_ENV=production` أو عند اتصال يشير إلى مضيف الإنتاج، يتطلّب `--force` وكتابة اسم القاعدة حرفياً، ولا يحذف أي ملف migration أبداً.
5. **بوابة checksum:** سكربت `db:verify` يحسب SHA-256 لكل ملف migration مُطبَّق (من `meta/_journal.json`) ويفشل إن تغيّر ملف بعد تطبيقه؛ يعمل في CI وقبل `db:migrate`.
6. **سكربتات البيانات (backfills):** لا استبدال صامت بقيمة افتراضية؛ عند تعذّر التحويل يُسجَّل الصف ويتوقف السكربت (أو `--force` صريح)، ويُطبع إيصال `(مُعدَّل / مُتخطّى / الكل)`، ويُبطل الكاش المعني بعد الكتابة.

## Considered Options

### Option 1: SQL في git · migrate عند النشر · drop محروس · checksum ← المختار
- **Pros:** الطريقة القياسية؛ تاريخ قابل للمراجعة والتراجع؛ أي بيئة تُبنى من الصفر.
- **Cons:** commit أولي يحتاج تحقّقاً يدوياً من مطابقة الإنتاج.

### Option 2: `drizzle-kit push` في الإنتاج
- **Pros:** بلا ملفات.
- **Cons:** بلا تاريخ ولا مراجعة DDL ولا تراجع؛ مرفوض في Est8Core لنفس السبب.

## Rationale

المحاور الحاكمة: **Reliability** (النشر لا يعتمد على جهاز واحد) و**Maintainability** (DDL مُراجَع في PR). Security جانبي (حارس `db:drop`). Cost صفر.

## Consequences

### Positive
- ✅ `git ls-files Src/Database/Migrations` يعرض كل المهاجرات؛ أي مطوّر يبني القاعدة من الصفر.
- ✅ `db:drop` في الإنتاج مستحيل بالخطأ.
- ✅ تعديل migration مُطبَّق يُلتقط قبل أن يسبب انحرافاً بين البيئات.

### Negative (Trade-offs المقبولة)
- ⚠️ التحقّق الأولي من مطابقة الملفات المحلية للإنتاج يدوي (مرة واحدة).
- ⚠️ خطوة نشر إضافية.

### Risks
- 🚨 الملفات المحلية التسعة لا تطابق الإنتاج فعلاً — Mitigation: توليد baseline جديدة من الإنتاج (`drizzle-kit introspect`) واعتمادها كـ migration 0000 إن ظهر اختلاف.

## Migration Path

T-S-19 كاملة، مع تحديث `README`/`CLAUDE.md §7` بإجراء النشر.
