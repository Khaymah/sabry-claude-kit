# ADR-0005: الإقليم جدول جديد على السيرفر، والنوع (Urban/Coastal) يعيد استخدام `CityHomeId`

- **Status:** Accepted — الاتجاه اعتمده Sabry في 2026-09-30 (جداول على السيرفر لا خريطة في العميل، وإعادة استخدام `CityHomeId` للنوع بشرط إعادة تسميته). نُفّذت المرحلتان A (`Backend/Admin`) وB (`Backend/Server`) في 2026-10-01 على فرعي `feat/regions-project-type` (غير مدفوعين بعد). **المستهلك الأول تطبيق الموبايل عبر `/api/v4`** (قرار Sabry 2026-10-01)؛ `Frontend/Client` بلا تغيير.
- **Date:** 2026-09-30 (تنفيذ 2026-10-01)
- **Deciders:** Sabry
- **Project:** Master-V (`Backend/Server` · `Backend/Admin` للـ migrations · تطبيق الموبايل عبر `/api/v4`؛ `Frontend/Client` خارج النطاق)
- **Tags:** schema, api-contract, filters, reference-data
- **Related:** `D:\Work\1-Nodejs\New Master\Filter-Hierarchy-Comparison.md` · الرسم الهرمي <https://claude.ai/artifact/UXMLZn8Fq2QxPRuxvC44ij>

## Context

- الواجهة الجديدة (`master-v-urban-coastal-v2.html`) تضيف طبقتين فوق المدن: **النوع** (Urban / Coastal) و**الإقليم** (East Cairo، West Cairo، North Coast، Red Sea). السيرفر يعرف Section → City → Area فقط.
- Sabry حدّد النموذج المستهدف: القسم صفة على المدينة (موجود فعلاً في `CitySectionsAllowed`)، النوع → الإقليم → المدينة شجرة، والمنطقة تتبع مدينتها دائماً.
- **اكتشاف أثناء التحليل:** migration `006_add_home_id.js` في `Backend/Admin` أضافت `CityHomeId` على `Cities` و`TypeHomeId` على `Types`، وتعليق الـ SQL فيها يحدّد النية: Home 1 = المدن الداخلية (1 إلى 5)، Home 2 = الساحلية (6 و7) مع أنواع الوحدات الساحلية (مجموعات Chalet وHotels وService & Hotels). أي أن مستوى "النوع" له عمود جاهز.
- الـ backfill في 006 مكتوب كتعليق يدوي ولم يُطبَّق محلياً: كل المدن والأنواع بقيمة 1 (لقطة 2026-09-30). حالة الإنتاج غير معروفة.
- السيرفر يستخدم `HomeId` فعلاً: `FilterTypes.sql` يفلتر الأنواع بـ `FIND_IN_SET(HomeId, TypeHomeId)`، و`Index` يعيد `Types[].SubTypes[].HomeId`.
- الاشتراك (`UserCities`) زوج (مدينة، قسم). أي تجميع جديد يجب ألا يغيّر وحدة الاشتراك ولا الصلاحيات.
- قاعدة بيانات واحدة مشتركة بين كل المشاريع. الـ migrations في `Backend/Admin/Database/Migrations` (آخر رقم 008)، و`AUTO_MIGRATE=true` يشغّل `up()` عند أول تشغيل، فيجب أن تكون idempotent.

## Decision

1. **النوع (Project Type) = العمود الموجود بعد إعادة تسميته.** `Cities.CityHomeId` → `Cities.CityProjectTypeId`، و`Types.TypeHomeId` → `Types.TypeProjectTypeId` للاتساق (نفس المفهوم، نفس القيم). الاسم مأخوذ من مصطلح الواجهة نفسها "Select Project Type". لا جدول جديد: الأسماء ثابتة في كود السيرفر (`Utility/ProjectTypes.js` في المشروعين: 1 = Urban / حضري، 2 = Coastal / ساحلي) وتُعاد في `Index` كمفتاح علوي `ProjectTypes[]` بينما كل مدينة تحمل `CityProjectTypeId` فقط. يمكن لاحقاً نقلها إلى جدول lookup بلا كسر.
   Backfill داخل نفس الـ migration: المدن 6 و7 → 2. أنواع الوحدات في المجموعات 4 و5 و6 → القيمة الانتقالية `"1,2"` (لا `"2"`) حتى لا تختفي الأنواع الساحلية عن أي عميل يرسل 1.
   **تسلسل إعادة التسمية على قاعدة مشتركة:** migration أولى تضيف العمود الجديد وتنسخ القيم وتُبقي القديم؛ موديلات `Backend/Server` و`Backend/Admin` تتحوّل للاسم الجديد وتُنشر؛ migration ثانية لاحقة تحذف العمود القديم. لا rename مباشر، لأن أي تطبيق لم يُنشر بعد سيفشل في `findAll` على الموديل.
2. **الإقليم = جدول جديد `Regions`** بأعمدة `RegionId`، `RegionName`، `RegionNameAr`، `RegionProjectTypeId` (1 أو 2)، `RegionOrder`. وعمود جديد `CityRegionId` على `Cities` مع index، بلا FK constraint فعلي اتساقاً مع بقية جداول `DataHelper`.
   Seed داخل الـ migration: East Cairo (Home 1) ← المدن 1 و2 و3 و4؛ West Cairo (Home 1) ← 5؛ North Coast (Home 2) ← 6؛ Red Sea (Home 2) ← 7.
3. **استجابة `Index`:** كل مدينة تحمل `CityRegionId` (رقم أو `null`) و`CityProjectTypeId`، ويُضاف مفتاحا `Regions[]` (بالاسمين و`RegionProjectTypeId` والترتيب) و`ProjectTypes[]`. الأنواع تحمل `SubTypes[].ProjectTypeIds` مع الحقل القديم `HomeId` بجانبه للموبايل. العملاء يبنون الشجرة منه؛ التسليم للموبايل في `Backend/Server/Docs/V4-Regions-Project-Type-Mobile-Handoff.md`.
4. **عقد `/data` لا يتغيّر.** الفلتر يبقى `DataCityId` و`DataAreaId`. الإقليم والنوع يُترجمان في العميل إلى قائمة `CityId`. لا مساس بمُنشئ SQL في `Details.js`.
5. **الاشتراك والصلاحيات كما هي:** زوج (مدينة، قسم). الإقليم لا يدخل فيهما.
6. **الموديلات تُنسخ في المشروعين:** `DataHelper/Region.js` جديد وإضافات `City.js` في `Backend/Server` و`Backend/Admin` معاً.
7. **الأدمن:** الحد الأدنى هو الـ seed. شاشة إدارة الأقاليم وربط المدينة بإقليم مهمة لاحقة منفصلة.

## Consequences

- ✅ مصدر حقيقة واحد للموبايل والويب والأدمن. إضافة مدينة أو إقليم لا تحتاج نشر عملاء.
- ✅ لا تغيير على عقد `/data` ولا على SQL المشترك مع الموبايل. الحقول الجديدة في `Index` إضافية، فالنسخ القديمة تتجاهلها.
- ✅ يستثمر عموداً موجوداً وفلتر أنواع جاهزاً بدل تكرار المعنى في جدول ثانٍ لقيمتين.
- ⚠️ **backfill الـ HomeId يغيّر سلوك فلتر الأنواع:** بعد التطبيق، الأنواع الساحلية تظهر فقط عندما يرسل العميل `HomeId=2`. أي عميل يرسل 1 دائماً سيفقدها في المدن الساحلية. يجب التحقق مما يرسله كل عميل قبل الـ backfill، أو جعل `TypeHomeId` للأنواع الساحلية "1,2" كمرحلة انتقالية.
- ⚠️ migration على قاعدة مشتركة مع `AUTO_MIGRATE=true`: تعمل عند أول تشغيل للأدمن. الـ seed يجب أن يكون محمياً (إدراج فقط إن لم يوجد) والـ `UPDATE` مقيّداً بـ `WHERE CityRegionId IS NULL`.
- ⚠️ إقليم واحد لكل مدينة (عمود لا جدول وسيط). إن احتجنا مدينة في إقليمين لاحقاً فهذا قرار جديد.
- ⚠️ حتى تُبنى شاشة الأدمن، تعديل الأقاليم بالـ SQL يدوياً.

## Alternatives Considered

- **جدول `ProjectTypes` مستقل (اختيار Sabry الأولي قبل اكتشاف `CityHomeId`):** مؤجَّل لا مرفوض. `CityHomeId` يؤدي نفس الدور وله استخدام فعلي، وجدول ثانٍ لقيمتين يضيف join ومعنى مكرّراً. القرار النهائي لـ Sabry.
- **خريطة ثابتة في العميل:** مرفوض (قرار Sabry 2026-09-30). كل مدينة جديدة تحتاج نشر كل عميل، والموبايل يتأخر عن الويب.
- **تمرير `RegionId` في عقد `/data` وتوسيعه على السيرفر:** مرفوض الآن. يلمس مُنشئ SQL المشترك ويكرّر ما يفعله العميل بقائمة `CityId`. يمكن إضافته لاحقاً كتسهيل.
- **توسيع قيم `CityHomeId` إلى 4 لتمثيل الإقليم:** مرفوض. يخلط النوع بالإقليم ويكسر معنى `TypeHomeId` للأنواع.

## Open items (بعد التنفيذ)

1. ~~تأكيد قيم `CityHomeId` و`TypeHomeId` على الإنتاج.~~ أُسقِط 2026-10-05: العمودان يُحذفان في 010 (ADR-0006) والـ backfill في 009 يعتمد على معرّفات المدن والمجموعات الثابتة فقط.
2. **مُخفَّف:** ما يرسله الموبايل في `HomeId`: الأنواع الساحلية بقيمة `"1,2"` انتقالياً فلا يختفي شيء أياً كان ما يُرسل، و`HomeId` في `Index` يبقى رقماً كما كان. الانتقال إلى `ProjectTypeId` مطلوب من فريق الموبايل (مستند التسليم). التضييق إلى `"2"` قرار لاحق بعد اكتمال الانتقال.
3. ~~موافقة Sabry على إعادة استخدام `CityHomeId` بدل جدول `ProjectTypes`.~~ محسوم 2026-09-30، والاسم النهائي `CityProjectTypeId` / `TypeProjectTypeId`.
4. ~~الواجهة العامة لفلتر الأنواع.~~ نُفّذ: `/data/filter/types` يقبل `ProjectTypeId` و`HomeId`، والقيمة غير الصالحة تُعامل كـ 1 بلا خطأ.
5. ~~حذف العمودين القديمين (migration 010).~~ نُفّذ 2026-10-05 في `010_city_is_active_and_drop_home_id.js` مع `CityIsActive` (ADR-0006). `HomeId` في `Index` صار أول قيمة في `ProjectTypeIds`.

## References

- خطة التنفيذ: `D:\Work\1-Nodejs\New Master\Filter-Hierarchy-Plan.md`
- `Backend/Admin/Database/Migrations/009_regions_and_project_type.js`
- `Backend/Server/Docs/regions-and-project-type.md` و`Backend/Server/Docs/V4-Regions-Project-Type-Mobile-Handoff.md`
- `Backend/Admin/Database/Migrations/006_add_home_id.js`
- `Backend/Server/Database/Sql/Data/FilterTypes.sql`
- `Backend/Server/Repository/Public/Root.js` (`getCachedTypes`، `getCachedAnonymousCities`، `fetchAreasForPairs`)
- `Backend/Server/Repository/_Schemas/Details.js` (بناء شرط المدينة والمنطقة)
