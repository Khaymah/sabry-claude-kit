# ADR-0001: استبدال إرسال واتساب عبر السيرفر (Baileys) بـ Web Share API على العميل

- **Status:** Accepted (Phase 1 + Phase 2 مُنفّذان — كل التدفّقات موصّلة، side-by-side مع WhatsAppSender)
- **Date:** 2026-07-19
- **Deciders:** Sabry
- **Project:** Master-V (Frontend/Client)
- **Tags:** architecture, frontend, share, reliability, cost, security

## Context

مشاركة المحتوى (صور Details/PaymentPlan/ROI، ملفات Layout/PriceList/Materials، الموقع) كانت تمرّ عبر مكوّن `Common/WhatsAppSender` → `useSendMessageMutation` → endpoint `/public/send` على السيرفر، الذي يرسل فعلياً عبر **جلسة واتساب للمستخدم (Baileys)**، مشروطاً بـ `UserIsConnectedSession` ورقم مستقبِل يُكتب يدوياً.

- المشكلة: الاعتماد على جلسة Baileys على السيرفر = نقطة فشل متكرّرة (الجلسات تفصل) + حمل سيرفر + تعقيد.
- 13 call site = 7 تدفّقات فعلية (Image base64، ملفات CDN، multi-file حتى 15، نص/إحداثيات).
- Audit (2026-07-19): `Type` string شبه تجميلي (معظمه يرجع لنفس فرع default) — التصنيف الصحيح حسب **شكل البيانات**.

## Decision

نستبدل الإرسال عبر السيرفر بـ **Web Share API (Level 2)** على العميل، بنمط **hybrid**: `navigator.share`/`canShare({files})` أساسي، ومع fallback **تنزيل الملفات + نسخ النص** عند عدم الدعم. طبقة مشتركة `Utility/ShareSheet.js` + مكوّن `Common/ShareButton` تحلّ محل `WhatsAppSender` تدريجياً.

## Considered Options

### Option 1: الإبقاء على السيرفر (Baileys) — مرفوض
- **Pros:** استهداف رقم تلقائي، تأكيد تسليم لكل ملف.
- **Cons:** هشاشة الجلسات، حمل السيرفر، تعقيد، تكلفة.

### Option 2: `wa.me` deep link فقط — مرفوض كأساس
- **Pros:** يستهدف واتساب مباشرة.
- **Cons:** نص/رابط فقط — **لا يرفع ملفات** إطلاقاً.

### Option 3: Web Share API (hybrid) ← المختار
- **Pros:** ملفات متعددة + نص، أصلي للجهاز، صفر سيرفر، يشيل Baileys من المسار.
- **Cons:** يفقد استهداف الرقم التلقائي، دعم متفاوت (Firefox/desktop/WebView)، CORS لملفات CDN.

## Rationale

Web Share هو الوحيد الذي يدعم مشاركة ملفات أصلية بلا سيرفر. الـ hybrid يغطّي الفجوات (fallback تنزيل+نسخ). إلغاء Baileys من مسار المشاركة يرفع الموثوقية ويقلّل التكلفة — وهو الدافع الأساسي.

## Consequences

### Positive
- ✅ صفر اعتماد على السيرفر/Baileys للمشاركة (Reliability + Cost).
- ✅ تبسيط UI: يختفي `PhoneInput` + بوابة الجلسة + الـ cooldown.
- ✅ التصنيف حسب شكل البيانات (أمتن من `Type`).

### Negative (Trade-offs مقبولة — أقرّها Sabry)
- ⚠️ **فقدان الاستهداف التلقائي للرقم** — المستخدم يختار الجهة من الـ share sheet.
- ⚠️ نص + ملفات معاً غير موثوق (لذلك: صور = ملف فقط، إحداثيات = نص فقط).
- ⚠️ لا تأكيد تسليم بعد فتح الـ share sheet.

### Risks
- 🚨 **CORS على مسارات صور الـ CDN غير مثبت** (مثبت للـ PDF/DOC و`/offer`) — Mitigation: التحقق قبل Phase 2 (تدفّقات D/E/F).
- 🚨 داخل Flutter WebView `navigator.share` غير موجود → يقع على الـ fallback (AppBridge أُلغي لهذا المسار بقرار Sabry).
- 🚨 multi-file (Materials حتى 15) محدود على المنصّات — قرار مؤجّل لـ Phase 2.

## Validation Plan

**المُنفّذ حتى الآن (ESLint + build نظيفان):**
- الطبقة المشتركة `ShareSheet` + `ShareButton` (Kind: Image / Coordinates / File).
- Screenshots **بضغطة واحدة**: Details = pre-gen عند فتح الـ FullScreen؛ PaymentPlan/ROI = **إبطال فوري + إعادة توليد مؤجّلة (900ms)** عند تغيير المدخلات (Pay/Roi modals) → تبقى جاهزة لـ share sheet على iOS.
- Location (Coordinates) — نص.
- **Offer** (Kind="File") عبر `Helper.FetchFileFromUrl` (URL→File) + `Helper.SaveFile` (fallback).
- **فصل حصة التحميل:** المشاركة تجلب الرابط **الخام بلا معاملات `Download`** → لا تُحتسب؛ زرار التنزيل الصريح فقط يُحتسب.
- إصلاحات ما بعد المراجعة: إزالة DEV auto-download (كان يعمل spam مع التوليد التلقائي)، حارس `PayPlan` (يمنع toast تلقائي)، deps أساسية بدل كائن `Inputs` (يضمن استقرار الـ debounce).

**Phase 2 — مُنفّذ بالكامل (2026-07-19):** `ShareButton` موصّل **جنب** `WhatsAppSender` (side-by-side، لم يُحذف القديم) في:
- **FileView** (`Common/FileView/index.jsx` + `Modal.jsx`) — Layout — `Kind="File"` بـ `ProcessUrl(State.Content)`.
- **PriceList** (`View/PriceList/index.jsx`) — `Kind="File"` بـ `ProcessUrl(state.path)`.
- **Materials** (`View/Matrial/index.jsx`) — `Kind="Files"` (شارك كل المختار) بـ URLs محلولة عبر `RoutingManager.ResolveCdnUrl` + `NoSource` يعطّل الزر عند صفر اختيار.
- **Navbar** (`Common/Navbar/NewVersion.jsx`) — **multiplexer** (`useMemo ShareConfig`): يحوّل `SenderData.SendType` (List→Files، Coordinates→نص، MasterPlan/Layout/Single→File) مع حلّ الروابط.
- قرار تعدد الملفات: **شارك كل المختار** عبر `Helper.FetchFilesFromUrls` → `navigator.share({files:[...]})` (fallback: حفظ الكل محلياً).

**التحقق (ESLint + build نظيفان):**
- ✅ ESLint نظيف على الملفات الخمسة + `npm run build` ناجح.
- ✅ **Adversarial workflow** (3 مراجعين Sonnet — correctness/regression/consistency): **صفر findings**.
- ✅ **اختبار حيّ على localhost:3000** (Rewaq): Materials `Kind="Files"` — الزر يظهر، **معطّل عند صفر اختيار** ويُفعّل بعد الاختيار؛ جلب plain GET لـ PDF **10.9MB** بلا معاملات Download (`requestUrlHasDownloadParam:false`) status 200، و`navigator.canShare({files})` = true؛ Navbar multiplexer أظهر زر `Kind="File"` مُفعّلاً جنب WhatsAppSender لـ Master Plan؛ **صفر console errors**.

**يبقى يدوياً (غير قابل للأتمتة):** فتح الـ OS share sheet نفسه واختيار واتساب — يجب تجربته على جهاز حقيقي.

### إصلاح لاحق (2026-07-19): مشاركة الـ Description مع الملفات (Materials)
- **المشكلة:** `ShareButton Kind="Files"` كان يشارك الملفات فقط ويتجاهل نص الـ Description (الـ `Message`) الذي يبعثه WhatsAppSender القديم.
- **الإصلاح:**
  - `ShareSheet.CanShareFiles(Files, Text)` صار يفحص `navigator.canShare({files, text})` معاً (backward-compatible).
  - `ShareButton Kind="Files"`: يقرأ `Data.Text`؛ لو `canShare({text,files})` مدعوم → يشارك الاثنين؛ لو لأ → يشارك الملفات + **ينسخ الوصف للحافظة** كي لا يضيع؛ ويدعم "وصف بلا ملفات" (نص فقط). `NoSource` صار يُفعّل الزر لو فيه ملفات **أو** نص.
  - **Materials موبايل** (`View/Matrial/index.jsx`): يمرّر `Text: Checked.Description ? Data.Extra : null`.
  - **Materials ديسكتوب** يمرّ عبر **الـ Navbar** (V2 → `OnChecked` → `useCheckedAssets` → `useSenderPayload` بـ `descriptionEnabled` + `selectedFiles`)؛ Navbar List case يمرّر `Text: Data.Message`.
- **تحقق حيّ (localhost, Rewaq):** بعد اختيار Description + ملف صورة، تتبّع OnShare أثبت `CanBoth:true` → `navigator.share({text, files})` استُدعي بنجاح (فتح الـ share sheet، بلا خطأ). فحص canShare({text,files}) = true على Chrome desktop. build + eslint نظيفان.
- **ملاحظة architecture:** الـ Materials له نسختان: `index.jsx` (موبايل، sender inline) و `V2.jsx` (ديسكتوب، بلا sender inline — يفوّض للـ Navbar). أي تعديل على مشاركة Materials لازم يغطّي المسارين.

### إصلاح ثانٍ (2026-07-19): مصدر نص الوصف server-side
- **المشكلة المكتشفة:** `Item.DataDescription` (مثلاً "2548") ليس نص الوصف — إنه **رقم/فلاج** ("عنده وصف"). النص الحقيقي على **السيرفر فقط** (`GET /data/desc?CompoundId=`، النص في `data.data`). `WhatsAppSender` (List) يبعت `body.Message = DataDescription > 10 ? CompoundId : "false"` → السيرفر يجلب النص ويرسله. أما Web Share كان يمرّر الفلاج نفسه كنص → شارك "2548".
- **الحل (RTK cache + fallback، المسارين):**
  - Redux: أُضيف `GetDescriptionText: build.query` (cached بالـ CompoundId) + `useLazyGetDescriptionTextQuery` — بجانب الـ mutation الموجود بلا مساس.
  - `ShareButton`: prop جديد `PrepareText` (async). في فرع Files يُجلب **النص (PrepareText) والملفات بالتوازي** (`Promise.all` — حفاظاً على نافذة الـ activation)، مع `.catch(()=>null)` (فشل الوصف = مشاركة ملفات فقط، لا إجهاض). النص المُحلّ يُستخدم في الـ share **وفي الـ fallback (نسخ للحافظة)** — والفلاج لم يعد يُمرَّر كنص من أي call site.
  - Materials موبايل + Navbar ديسكتوب: يمرّرا `PrepareText` (يجلب عبر الـ query المُخزّن) بدل الفلاج؛ يتخطّى الجلب لو الفلاج < 10.
- **تحقق حيّ (localhost, Rewaq):** بعد Description + ملف، التقاط payload الـ `navigator.share` الفعلي = `{keys:["text","files"], textLen:1451, fileCount:1}` والنص = **الوصف التسويقي الكامل نفسه اللي بيظهر على واتساب**. build + eslint نظيفان.
- **iOS:** أول مشاركة (غير مخزّنة) قد تجلب النص حيّاً؛ على iOS الصارم قد تقع على fallback (تنزيل + **نسخ الوصف الحقيقي** للحافظة) — مقبول ومقصود.

### إصلاح ثالث (2026-07-19): موثوقية المشاركة (عرضان مؤكّدان بالكود)
- **العرض 1 — "الشاشة مفتوحة بقالها شوية → مفيش مشاركة":** روابط الـ CDN عبارة عن AES-GCM token بصلاحية **ساعة** (`Cdn/Utility/HmacUrl.js` `DEFAULT_TTL=60*60`). بعد الانتهاء → الجلب يفشل → لا ملفات. **مش activation** — انتهاء صلاحية.
- **العرض 2 — "أشارك تاني بعد قليل → الـ dialog ما يفتحش":** `navigator.share()` يتطلّب **transient user activation (~5s)**؛ استدعاؤه بعد `await` (جلب الملفات) + `cache: "no-store"` (تحميل كامل كل مرة) → على الشبكة الحقيقية يتخطّى النافذة → `NotAllowedError`. (+ احتمال `InvalidStateError` لو مشاركة سابقة معلّقة.) الـ CDN يرسل `Cache-Control: max-age=0, stale-while-revalidate=300`.
- **الإصلاحات (الحل الكامل + in-memory cache):**
  - `Helper.FetchFileFromUrl`: **حذف `cache:"no-store"`** (يستغل SWR) + **كاش File في الذاكرة** (Map، LRU، حدّ ~50MB) → التكرار لحظي (يحفظ نافذة الـ activation) وينجو من انتهاء الـ token لو الملف اتجلب قبل كده.
  - `ShareSheet`: **concurrency guard** (`static Sharing`) يرجّع `"busy"` بدل استدعاء مشاركة فوق معلّقة (يمنع `InvalidStateError`).
  - `ShareButton`: **إشعار fallback مرئي** (`NotifyFallback` — لم يعد الوقوع صامتاً)، **رسالة انتهاء صلاحية واضحة** عند فشل الجلب (`SHARE.EXPIRED`)، معالجة حالة `"busy"`، و**Tooltip توضيحي** (`SHARE.TOOLTIP`: بديل لمن يواجه مشاكل Send WhatsApp + المتصفحات المدعومة Chrome/Edge/Safari/Opera + سلوك التنزيل/النسخ لو غير مدعوم).
  - `Lang` ar/en: قسم `SHARE` جديد (TOOLTIP, COPIED, FALLBACK_DONE, EXPIRED).
- **تحقق:** eslint + build نظيفان؛ التطبيق يفتح بلا console errors؛ الزر يظهر مُفعّلاً؛ الـ Tooltip مؤكّد في a11y tree بالنص الكامل. **السلوكيات المعتمدة على الشبكة (تكرار لحظي/activation) تُختبر على جهاز/شبكة المستخدم الحقيقية** — localhost أسرع من أن يُظهر العرضين.

## References

- Audit workflow: WhatsAppSender usage + AppBridge + CORS (2026-07-19).
- الملفات: `Utility/ShareSheet.js`، `Common/ShareButton/index.jsx`، 5 call sites (FullScreen Sm/Md، _Header Sm/Md، Map).
- `Common/WhatsAppSender` يبقى مؤقتاً لتدفّقات Phase 2 (C/D/E/F/G).
