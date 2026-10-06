# Bun + Hono Stack

## Runtime — Bun

- `.env` يُقرأ تلقائياً — لا `import 'dotenv/config'` أبداً
- `jose` يعمل مع Web Crypto API نيتيف — لا polyfill
- Package manager: `bun install` / `bun add` / `bun remove`
- Run: `bun run dev` / `bun start`
- Typecheck: `bun tsc --noEmit`
- Test runner: `bun test`

---

## Framework — Hono

- `c.header()` لا ينتقل إلى `new Response()` المُنشأ يدوياً
  → مرر headers مباشرة في constructor: `new Response(body, { headers: {...} })`
- استخدم `c.json()` / `c.text()` / `c.stream()` — تحمل headers تلقائياً
- Streaming الحقيقي: `c.stream((stream) => { ... })` — لا `new Response(ReadableStream)`
- Middleware order مهم: global middleware قبل route-specific
- `c.get('key')` / `c.set('key', value)` لمشاركة بيانات بين middleware

---

## Architecture — Modular Monolith

```tree
Src/
├── App.ts                    ← Hono app (routes mounting فقط)
├── Server.ts                 ← bootstrap + startup
│
├── Config/
│   ├── Env.ts                ← Zod env validation
│   ├── Database.ts           ← Drizzle + PostgreSQL connection
│   ├── Logger.ts             ← Pino setup
│   └── Constants.ts          ← app-wide constants
│
├── Core/
│   ├── Types/                ← global TS types (Api.Types.ts, Auth.Types.ts)
│   ├── Utils/                ← Crypto, Token, Date, Response, Validation
│   ├── Middleware/           ← Auth, Rbac, RateLimit, Csrf, Hmac, Lang, Logger, Error
│   ├── EventBus/             ← EventBus.ts + Events.Registry.ts
│   ├── Errors/               ← App.Errors.ts (custom error classes)
│   └── Response/             ← Response.Helper.ts (Success/Error format)
│
├── Modules/
│   └── [ModuleName]/
│       ├── Test/
│       │   ├── E2E/
│       │   ├── Integration/
│       │   ├── Unit/
│       │   └── Edge/
│       ├── [Module].Routes.ts      ← Route definitions only (لا logic)
│       ├── [Module].Controller.ts  ← Request parsing + validation + response
│       ├── [Module].Service.ts     ← Business logic (main logic here)
│       ├── [Module].Schema.ts      ← Zod validation schemas
│       ├── [Module].Events.ts      ← Event handlers
│       └── Models/
│           └── [Entity].Model.ts   ← Drizzle schema
│
├── Database/
│   ├── Schema.ts             ← All schemas re-exported
│   └── Migrations/           ← Drizzle migrations
│
└── Logs/
    ├── Errors/               ← Errors-YYYY-MM-DD.jsonl
    └── Warns/                ← Warns-YYYY-MM-DD.jsonl
```

### Module Responsibilities — لا تخلط بينها

| الملف | المسؤولية |
| --- | --- |
| `Routes.ts` | تعريف الـ routes + تطبيق الـ middleware فقط |
| `Controller.ts` | parsing الـ request + validation + استدعاء Service + إرجاع response |
| `Service.ts` | كل الـ business logic — الملف الرئيسي |
| `Schema.ts` | Zod schemas للـ validation |
| `Model.ts` | Drizzle table schema |

---

## Naming Conventions — MANDATORY

| النوع | الـ Convention | مثال |
| --- | --- | --- |
| Variables | PascalCase | `const UserData = ...` |
| Functions | PascalCase | `function GetUserById() {}` |
| Files | PascalCase + dots | `Auth.Controller.ts` |
| Folders | PascalCase | `Modules/Auth/Models/` |
| Interfaces | `I` + PascalCase | `interface IUserPayload` |
| Types | `T` + PascalCase | `type TApiResponse` |
| Enums | `E` + PascalCase | `enum EUserRole` |
| Constants | UPPER_SNAKE_CASE | `const MAX_RETRIES = 3` |
| DB Tables | PascalCase plural | `Users`, `RefreshTokens` |
| DB Columns | PascalCase | `CreatedAt`, `UserId` |
| API Routes | kebab-case | `/api/v1/auth/sign-in` |
| Env Variables | UPPER_SNAKE_CASE | `DATABASE_URL` |

> **PascalCase على كل شيء** — Variables، Functions، Files، Folders — لا استثناء.

---

## ORM — Drizzle + PostgreSQL

- لا `VARCHAR` — استخدم `TEXT`
- `update()` يتطلب `.where()` دائماً — بدونه يُحدّث **كل** الصفوف
- كل `WHERE` يتضمن `eq(Table.IsDeleted, false)` إلا في admin queries صريحة
- استخدم `.returning()` بعد `insert()` للحصول على `Id` و `CreatedAt`
- `Id`: uuidv7 — لا random UUID
- Timestamps: UTC — `withTimezone: true`
- لا hard delete — `IsDeleted: true` فقط (soft delete)
- Enum values في comparisons — لا string literals

```typescript
// Base columns — كل جدول يجب أن يحتويها
const BaseColumns = {
  Id: uuid("Id").primaryKey().$defaultFn(() => uuidv7()),
  CreatedAt: timestamp("CreatedAt", { withTimezone: true }).defaultNow(),
  UpdatedAt: timestamp("UpdatedAt", { withTimezone: true }).defaultNow(),
  IsDeleted: boolean("IsDeleted").default(false),
};
```

### Translation Tables — MANDATORY

```typescript
// ❌ ممنوع — أعمدة لكل لغة
{ NameAr: text("NameAr"), NameEn: text("NameEn") }

// ✅ صحيح — جدول ترجمة منفصل
// Entity          (Id, Slug, Price, ...BaseColumns)
// EntityTranslations (Id, EntityId FK, Locale, Name, Description)
//   Unique: (EntityId, Locale) + ON DELETE CASCADE
```

- API input: `Translations: [{ Locale, Title, Description }]`
- English (en) مطلوبة دائماً كـ fallback
- Snapshot data (OrderItems) → جدول ترجمة منفصل — لا JSONB

---

## Auth

- `jose` لـ JWT — لا `jsonwebtoken`
- `argon2` لـ password hashing — لا `bcrypt`
- Refresh tokens: httpOnly cookies
- Access tokens: Authorization header (Bearer)
- Auth/permissions في Routes middleware — لا manual checks في Controller

---

## Response Format

```typescript
// Success
{ Success: true, Data: {...}, Message: "i18n.key", Meta: { Page, Limit, Total } }

// Error
{ Success: false, Error: { Code: "AUTH_INVALID", Message: "translated", Details: [] } }
```

---

## Code Quality — Checklist

```txt
[ ] PascalCase naming for ALL identifiers
[ ] File header comment explaining purpose
[ ] JSDoc comment على كل function
[ ] Inline comments للـ complex logic
[ ] Zod schema لكل input
[ ] Custom errors من App.Errors.ts
[ ] Response format موحد (Success/Error)
[ ] UTC timestamps في كل مكان
[ ] I18n message keys — لا hardcoded strings
[ ] Events تُرسل للـ side effects
[ ] Module structure: Routes → Controller → Service → Model
[ ] uuidv7 لكل primary key
[ ] Soft delete (IsDeleted) — لا hard delete
[ ] لا any types — استخدم unknown + narrowing
[ ] Max 600 lines per file
[ ] HMAC verification على API routes
[ ] WHERE queries تتضمن IsDeleted = false
[ ] jose لـ JWT، argon2 لـ passwords، pino للـ logging
[ ] Translation tables منفصلة — لا NameAr/NameEn
[ ] Enum values في comparisons — لا string literals
[ ] Database-backed scheduling — لا setTimeout
[ ] Single source of truth — لا duplicate functions
```

---

## File Size Limit — MANDATORY

> **ممنوع أي ملف يتجاوز 600 سطر مطلقاً.**

إذا تجاوز → قسّم حسب المسؤولية:

- `Auth.Service.ts` → `Auth.Core.ts` + `Auth.OAuth.ts` + `Auth.Sessions.ts`
- الملف الأصلي يبقى كـ barrel re-export فقط

**مستثنى:** Test files, Seed data, Config/Catalog files

---

## TypeScript

- `export type { Foo }` = type فقط → لا تعمل للقيمة في runtime
- `export { Foo }` = القيمة والـ type → استخدم هذا في barrel files
- لا `any` — استخدم `unknown` + type narrowing
- Interface prefix: `I` — Type prefix: `T` — Enum prefix: `E`

---

## Performance

- Streaming responses (SSE) لتقليل وقت الانتظار
- Redis للـ caching + rate limiting + session store
- Database connection pooling
- كل شيء stateless ليسهل التوسع أفقياً

---

## Testing

- مسار: `Module/Test/` → E2E / Integration / Unit / Edge
- `bun test` لتشغيل كل الـ tests
- Mock interfaces — لا concrete implementations
- Integration tests تضرب DB حقيقية — لا mocks للـ database
