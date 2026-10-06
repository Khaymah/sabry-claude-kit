# ADR-0004: Auth متوازن (JWT + Refresh + CSRF + argon2id + Static RBAC) + ملفات عامة بروابط ثابتة

- **Status:** Accepted
- **Date:** 2026-07-11
- **Deciders:** Sabry
- **Project:** SweetsStore
- **Tags:** security, auth, jwt, rbac, files, risk-acceptance

## Context

لوحة الأدمن (Owner/Employee) + مسار عام للطلبات (guest). الهدف **production-ready** لكن **متوازن** بين سرعة البدء والأمان — لا over-engineering ولا إهمال. قرار Sabry الصريح: نكتفي بـ **JWT + Refresh + CSRF** حاليًا، والملفات تُعامَل كـ **بيانات عامة** (لا مشكلة في تسريبها) بروابط تُرجَّع جاهزة في الـ list data.

سوابق داخلية متاحة عند الترقية: Est8Core ADR-0001 (denylist) · AdhamFathallah ADR-0001 (RBAC static).

## Decision

**Auth (متوازن):**
1. **argon2id** + pepper + salt لكلمات المرور.
2. **Access JWT قصير (~15د)** بـ jose، خوارزمية محدّدة صراحةً في التحقق، Bearer header، in-memory على الفرونت.
3. **Refresh token** في httpOnly + Secure + SameSite=Strict cookie، مُخزَّن hashed في `RefreshTokens` (يتيح logout/logout-all)، rotation بسيط.
4. **CSRF** (SameSite + Origin check + double-submit token) على المسارات cookie-based.
5. **RBAC static** (roles-as-keys + permission map + عمود `Users.Permissions` JSON override) مُنفَّذ في **middleware مركزي** + **object-level (BOLA)**.
6. **throttle** على sign-in و orders-create (per-phone/IP) + **حساب الأسعار/الرسوم server-side** + allowlist DTO.

**Files (بيانات عامة):**
7. رفع **chunked + sharp** (magic-bytes + strip EXIF + WebP + thumbnails)، رفع الإيصال (guest) بـ **upload token مربوط بالأوردر** (يمنع الرفع العشوائي/إغراق القرص).
8. **روابط ثابتة غير منتهية** بمسار عشوائي غير قابل للتخمين، تُخدَم static من Nginx (cache immutable)، **تُرجَّع جاهزة داخل list/detail data** — **لا signed-URL endpoint، لا expiry**.

**مؤجّل بوعي (يُضاف عند الحاجة بلا إعادة كتابة):** Postgres denylist (إبطال access فوري) · reuse-detection/token-family · HMAC · OTP/CAPTCHA · MFA.

## Considered Options

- **Auth كامل enterprise** (denylist + reuse-detection + HMAC + OTP + MFA): أقوى لكن over-engineering لمحل بموظفين اثنين في البداية — **مؤجّل**.
- **Auth متوازن (JWT+refresh+CSRF+argon2+RBAC) ← المختار:** production-ready، سريع البدء، قابل للترقية بالسوابق.
- **Files: signed URLs + X-Accel + expiry + per-view authz:** أأمن لكن أبطأ وأعقد ويتطلب endpoint/نداء لكل ملف — **مرفوض** بقرار المالك (الملفات عامة).
- **Files: روابط ثابتة عامة في list data ← المختار:** أسرع + cache-friendly + أبسط.

## Rationale

المزيج المتوازن يغطّي أخطر فئات JWT (XSS عبر in-memory access + httpOnly refresh، alg confusion، CSRF) بأقل تعقيد، ويؤجّل ما ليس ضروريًا الآن بوضوح. معاملة الملفات كعامة تلغي طبقة كاملة (signing/streaming/expiry) وتعطي عرضًا شبه فوري عبر الـ cache والروابط الجاهزة — قرار قيمة واعٍ من المالك.

## Consequences

### Positive
- ✅ Auth production-ready بسريع بدء وتعقيد أقل. · logout/logout-all يعمل (حذف refresh).
- ✅ RBAC مركزي = تقليل Broken Access Control. · server-side calc يمنع تلاعب الأسعار.
- ✅ عرض ملفات سريع + cache-friendly بلا نداءات إضافية. · قابلية ترقية بلا إعادة كتابة.

### Accepted Risks (موثّقة — قرار المالك)
| Risk | القبول | Compensating Control | مراجعة |
|------|--------|----------------------|--------|
| **لا إبطال access فوري** (بلا denylist): access مسروق صالح حتى ≤15د بعد logout | مقبول لفريق أدمن صغير | access TTL قصير + refresh revoke؛ نضيف denylist لو لزم | 2026-10-11 |
| **الإيصالات بروابط عامة غير منتهية**: تسريب الرابط = مشاهدة الإيصال | مقبول (الملفات "عامة" عند المالك) | مسار عشوائي non-enumerable + يظهر فقط في ردود الأدمن + لا فهرسة عامة | 2026-10-11 |
| **بلا OTP/CAPTCHA** على الطلب العام | مقبول للبدء | throttle per-phone/IP + Idempotency + flagging؛ نضيف OTP لو ظهرت إساءة | 2026-10-11 |

### Negative (Trade-offs)
- ⚠️ concurrent refresh قد يفشل → grace window/refresh-lock. · ⚠️ إدارة عدة secrets → موثّقة + rotation سريع.

## Validation Plan
- **Metric 1:** موظف يصل endpoints الأدمن → مرفوض (RBAC). · **Metric 2:** تلاعب سعر من الـ client → السعر النهائي server-side. · **Metric 3:** رابط ملف يظهر جاهزًا في list data ويُخدَم من الـ cache.
- **Review date:** 2026-10-11.

## References
- سابقة (للترقية): Est8Core ADR-0001 (denylist) · AdhamFathallah ADR-0001 (RBAC static)
- ADR-0002 (تخزين الملفات) · [Backend-Implementation-Plan.md] · OWASP ASVS L2 · API Top 10 (BOLA)
