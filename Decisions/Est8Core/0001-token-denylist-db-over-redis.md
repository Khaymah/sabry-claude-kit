# ADR-0001: Token Denylist — PostgreSQL over Redis for Access Token Revocation

- **Status:** Accepted
- **Date:** 2026-06-09
- **Deciders:** Sabry
- **Project:** Est8Core
- **Tags:** security, auth, jwt, performance

## Context

بعد تنفيذ JWT-based auth، اكتشفنا أن access tokens تظل صالحة لمدة 15 دقيقة حتى بعد الـ logout — لأن JWT stateless بطبيعته. هذا يعني أن المستخدم يمكنه إعادة استخدام access token المسروق خلال نافذة الـ 15 دقيقة.

القيود:
- الـ Redis module لم يُهاجَر بعد (مطلوب decision الآن لأن RBAC يبنى فوق auth)
- MVP phase — نريد الحل الأبسط الذي يعمل الآن ويمكن استبداله لاحقاً
- الـ master DB (PostgreSQL) متاح بالفعل عبر `MasterDb`

## Decision

نستخدم **PostgreSQL `token_denylist` table في master DB** لتخزين JTIs المُبطَلة، بدلاً من Redis. كل request مُعتمَد يتحقق من الـ denylist عبر `WHERE jti = $1 AND expires_at > now()`.

## Considered Options

### Option 1: Redis Sorted Set (JTI → expiresAt score)
- **Pros:** O(1) lookup، TTL تلقائي، أداء ممتاز
- **Cons:** Redis module غير مُهاجَر، يضيف dependency جديد لـ MVP، setup إضافي

### Option 2: PostgreSQL token_denylist في master DB ← المختار
- **Pros:** zero new dependencies، master DB متاح بالفعل، idempotent migration، بسيط
- **Cons:** DB query لكل request مُعتمَد (+1 SELECT)، يحتاج cleanup job للـ expired entries

### Option 3: Shorter token TTL (5 دقائق بدلاً من 15)
- **Pros:** يقلص نافذة الخطر بدون state
- **Cons:** لا يحل المشكلة (logout لا يزال لا يُبطل الـ token فوراً)، يزيد refresh frequency

## Rationale

في MVP phase، الـ DB query الإضافية (lookup بـ PK على صف صغير) أسرع وأبسط من إضافة Redis dependency. الـ `jti` عمود PK = B-tree index = O(log n) في الأسوأ. الـ denylist سيظل صغيراً دائماً (entries تنتهي بعد 15 دقيقة).

عند نمو الحمل أو هجرة Redis: نستبدل الـ SELECT بـ Redis GET، بدون تغيير في interface الـ service/middleware.

## Consequences

### Positive
- ✅ Access tokens تُبطَل فوراً عند logout — no 15-min window
- ✅ Zero new dependencies في MVP
- ✅ Testable بـ real DB (test يُنشئ الجدول عبر IF NOT EXISTS)

### Negative (Trade-offs المقبولة)
- ⚠️ +1 SELECT query لكل request مُعتمَد — مقبول بما أن الـ denylist صغير
- ⚠️ لا TTL تلقائي على entries — يحتاج periodic cleanup job (can run nightly: `DELETE FROM token_denylist WHERE expires_at < now()`)

### Risks
- 🚨 إذا master DB بطيء/معطّل → كل auth requests تفشل — Mitigation: master DB already a SPOF للـ tenant lookup

## Migration Path

عند هجرة Redis:
1. أضف Redis client في `Config/Cache.ts`
2. استبدل `MasterDb.select().from(TokenDenylist)` في Auth.Middleware بـ `Redis.get(jti)`
3. استبدل `MasterDb.insert(TokenDenylist)` في Auth.Service.Logout بـ `Redis.set(jti, "1", "EXAT", expiresAt)`
4. احذف `token_denylist` table (أو ابقيها كـ fallback)

## References

- Implementation: `Server/Src/Core/Models/TokenDenylist.Model.ts`
- Denylist check: `Server/Src/Core/Middleware/Auth.Middleware.ts`
- Insert on logout: `Server/Src/Modules/Auth/Auth.Service.ts` — `Logout()`
