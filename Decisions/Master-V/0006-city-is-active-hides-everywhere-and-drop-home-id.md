# ADR-0006: تعطيل المدينة بـ `CityIsActive` يخفيها عن كل قارئ، وحذف عمودَي `HomeId`

- **Status:** Accepted — قرار Sabry 2026-10-05، نُفّذ في نفس اليوم على `Backend/Admin` (دُمج في master ودُفع)، `Backend/Server`
  (فرع `mobile` كاملاً، وفرع `master` بـ CityIsActive فقط بلا Regions)، وفرعَي `feat/city-is-active` في `AdhamFathallah` و`Backend/Free`.
- **Context:** Master-V يحتاج إخفاء مدينة بلا حذف صفوفها (كمباوندات، اشتراكات، إشعارات تشير إليها). في الوقت نفسه بقي
  عمودا `Cities.CityHomeId` و`Types.TypeHomeId` (migration 006، لم تُنشر لأي بناء) بعد أن حلّت محلهما أعمدة Project Type في 009.
  أربعة تطبيقات تقرأ `Cities` من قاعدة واحدة: Backend/Admin، Backend/Server (فرع `mobile`؛ `master` نسخة مختلفة بلا أي مرجع لـ HomeId)،
  AdhamFathallah/_Server، Backend/Free.

## Decision

1. **عمود `Cities.CityIsActive` TINYINT(1) NOT NULL DEFAULT 1** في migration 010 (Admin هو مالك الـ migrations الوحيد). الافتراضي في
   قاعدة البيانات 1 كي تبقى المدن الموجودة ظاهرة، لكن **الموديل افتراضيه `false`** (قرار Sabry، كوميت bcf6789): أي مدينة تُنشأ من
   الكود (استيراد أو POST) تبدأ مخفية حتى تُفعَّل صراحةً بالاستيراد `CityIsActive = TRUE`.
2. **الإخفاء كامل، حتى عن الأدمن** (قرار Sabry صراحةً). طبقتان: `defaultScope.where = { CityIsActive: true }` على موديل `City`
   في Admin وServer (يغطي findAll/findOne/findByPk/count/update)، وشرط صريح `CityIsActive = 1` في كل SQL خام أو `literal`
   يلمس `Cities` (Admin: عدّ القائمة، literals المستخدمين؛ Server: `Basic/Search/Filter/Notification.sql`، literals المستخدمين؛
   أدهم وFree: 7 مواضع SQL). مناطق المدينة المخفية تختفي معها (joins المناطق صارت INNER).
3. **طريق الإرجاع:** استيراد شيت المدن بعمود `CityIsActive = TRUE` (الاستيراد يبحث بـ `scope("WithInactive")` كي لا يضرب
   duplicate PK)، أو SQL يدوي. التعطيل عبر `PUT /api/v3/admin/city` بـ `CityIsActive: false` أو الاستيراد بـ `FALSE`. لا واجهة في
   Frontend/Admin (لا شاشة مدن هناك أصلاً).
4. **حذف `CityHomeId` و`TypeHomeId`** في نفس الـ migration، وحذف ملف 006 من الريبو، وتنظيف backfill 009 من أي مرجع لهما
   (يعتمد على `CityId IN (6,7)` و`TypeGroupId IN (4,5,6)` فقط). `HomeId` القديم في `Index` صار `ProjectTypeIds[0] || 1`.
5. **فحص الاسم عند الإنشاء/التعديل يشمل المدن المخفية** حتى لا يتكرّر اسم مدينة مخفية ثم تعود باسمٍ مكرّر.

## Trade-offs

- **نضحّي بثوانٍ من 500 على `root`/`filter/types` للموبايل لصالح نشرة واحدة:** Server المنشور (فرع `mobile`) ما زال يعلن العمودَين
  ويقرأ `TypeHomeId` في `FilterTypes.sql`، فإقلاع Admin بـ 010 يكسره حتى يُنشر فرع Server. Sabry اختار النشر تباعاً خلال ثوانٍ بدل
  نشر Admin مرتين.
- **مخاطرة مقبولة:** لو كان الإنتاج يحمل `TypeHomeId = 2` لمجموعات ساحلية، فالموبايل المثبّت كان يرى `HomeId = 2` وسيرى `1` الآن
  (القائمة `1,2`). لا يختفي نوع لأن `FilterTypes` يستخدم FIND_IN_SET على `1,2`.
- **اشتراكات المستخدمين في مدينة مخفية تبقى مخزّنة** (`UserCities`) لكنها لا تُعاد؛ إعادة التفعيل تُرجعها بلا تدخّل.
- **منطقة (Region) تحمل مدينة مخفية لا تُحذف** (عدّ الاستخدام يشمل المخفية) حتى لا تبقى مدينة يتيمة بعد إعادة التفعيل.

## Alternatives rejected

- **حذف صف المدينة فعلياً:** يكسر الكمباوندات والاشتراكات والإشعارات المرتبطة. مرفوض.
- **إخفاء عن العامة فقط مع إظهار للأدمن:** رفضه Sabry صراحةً ("مخفية حتى عن الأدمن").
- **الاحتفاظ بعمودَي HomeId خلف بوابة نشر (Task 10 الأصلية):** رفضه Sabry؛ الحذف الآن مع تسلسل نشر محكوم.

## ملاحظة تشغيلية: migration 001 على الإنتاج (2026-10-05)

أول نشر للأدمن بـ `AUTO_MIGRATE=true` سقط عند 001 لا 010: جدول `UserRateLimitUsage` على الإنتاج فيه صفوف مكرّرة لنفس
(UserId, ResourceName) فرُفض الـ unique index وتوقّف الـ runner قبل 009/010. 001 الآن تحذف التكرارات قبل الـ index **وتُبقي
الصف الأول (أقل Id)** لأنه الصف الحي (قرار Sabry). نفس المنطق لأي SQL يدوي: `DELETE Later ... WHERE First.Id < Later.Id`.

## Deploy / rollback

- قبل النشر: `AUTO_MIGRATE=true` في `.htaccess` الحي للأدمن، وSQL تراجع جاهز في phpMyAdmin (إعادة العمودَين nullable default 1،
  حذف `CityIsActive`، حذف صفَّي 009/010 من `Migrations`).
- **Passenger يقلع التطبيق عند أول طلب، لا عند `touch tmp/restart.txt`.** فالـ migration لا تعمل إلا حين يصل طلب للأدمن. التسلسل:
  1. Admin: pull → `touch tmp/restart.txt` → **افتح أي URL للأدمن** → تحقق في phpMyAdmin: `SHOW COLUMNS FROM Cities LIKE 'CityIsActive'`
     (أو صف 010 في `Migrations`). لا تكمل قبل ظهور العمود.
  2. Server (فرع الموبايل): pull → restart. بين الخطوتين `root`/`filter/types` للمسجّلين تعطي 500 (العمودان القديمان محذوفان وموديل
     الـ Server القديم يعلنهما).
  3. AdhamFathallah ثم Free: فقط بعد تأكيد الخطوة 1، وإلا `Unknown column CityIsActive`.
- **التراجع (بالترتيب، وإلا انقطاع ثانٍ):**
  1. SQL أولاً: أعِد العمودَين `CityHomeId`/`TypeHomeId` (nullable، default 1). الكود الجديد لا يتأثر بوجودهما، والـ Server القديم يحتاجهما.
  2. أرجِع كود التطبيقات الأربعة. **قبل** لمس جدول `Migrations` أرجِع Admin (أو ضع `AUTO_MIGRATE=false`)، لأن الكود الجديد مع
     صفوف 009/010 المحذوفة يعيد تشغيل 010 عند الإقلاع ويحذف العمودَين مرة أخرى.
  3. أخيراً واختيارياً احذف `CityIsActive` — فقط بعد أن يكون أدهم وFree وServer على الكود القديم، وإلا `Unknown column` في ~14 موضعاً.
     تركه لا يضرّ الكود القديم.
  `down()` في 010 ينفّذ 1 و3 معاً، فلا تستدعِه إلا بعد الخطوة 2 كاملة. 009 تبقى مصدر الحقيقة لنوع المشروع.

## References

- `D:\Work\1-Nodejs\New Master\City-Active-And-HomeId-Drop-Plan.md`
- `Backend/Admin/Database/Migrations/010_city_is_active_and_drop_home_id.js`
- `Backend/Server/Docs/regions-and-project-type.md` (قسم "المدن غير الفعّالة")
- ADR-0005 (الأقاليم ونوع المشروع)
