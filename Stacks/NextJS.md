# Next.js Stack (App Router)

## Versions

- Next.js 16+ App Router
- React 19+
- TypeScript strict
- Tailwind CSS v4

---

## Architecture — Project Structure

```tree
src/
├── App/                          ← Next.js App Router root
│   ├── [locale]/                 ← i18n route prefix (en / ar)
│   │   ├── layout.tsx            ← Root layout (theme, fonts, dir)
│   │   ├── page.tsx              ← Home page
│   │   ├── (public)/             ← Public route group
│   │   └── (admin)/              ← Admin route group
│   ├── sitemap.ts                ← Dynamic sitemap
│   └── robots.ts                 ← Robots.txt
│
├── Components/
│   ├── Common/                   ← مشتركة بين كل المناطق
│   ├── Public/                   ← واجهة العميل
│   │   ├── Layout/               ← Header, Footer, Navigation
│   │   └── [Feature]/            ← Feature components
│   └── Admin/                    ← لوحة الإدارة
│       └── [Feature]/
│
├── Stores/                       ← Zustand stores
│   ├── Cart.Store.ts
│   └── Theme.Store.ts
│
├── Lib/
│   ├── GraphQL/
│   │   ├── Client.ts             ← Apollo CSR client
│   │   ├── SSR.Client.ts         ← Apollo SSR client
│   │   └── Generated.ts          ← auto-generated types + hooks
│   ├── Domain/                   ← client-side type definitions
│   └── Auth.Session.ts           ← session helpers
│
├── I18n/
│   └── Locales/
│       ├── En.ts
│       └── Ar.ts
│
└── Styles/
    ├── Globals.css               ← @import "tailwindcss" + @theme {}
    └── Themes/
        ├── DarkNavy.css
        ├── Light.css
        └── NavyBranded.css
```

### Page Structure — كل صفحة

```tree
[page-name]/
├── page.tsx           ← Server Component (metadata + data fetching)
├── PageContent.tsx    ← Client orchestration (≤ 300 سطر)
├── _types.ts          ← Page-specific types
├── _hooks.ts          ← State + logic (custom hooks)
├── _utils.ts          ← Helper functions
└── components/        ← كل component في ملف مستقل
    ├── SomeDialog.tsx
    ├── SomeTable.tsx
    └── SomeCard.tsx
```

---

## Naming Conventions — MANDATORY

| النوع | الـ Convention | مثال |
| --- | --- | --- |
| Variables | PascalCase | `const UserData = ...` |
| Functions | PascalCase | `function GetUserById() {}` |
| Files | PascalCase | `TreeView.tsx`, `Cart.Store.ts` |
| Folders | PascalCase | `Components/Packs/`, `Stores/` |
| Interfaces | `I` + PascalCase | `interface IPackNode` |
| Types | `T` + PascalCase | `type TCartItem` |
| Enums | `E` + PascalCase | `enum ETheme` |
| Constants | UPPER_SNAKE_CASE | `const MAX_CART_ITEMS = 50` |
| Components | PascalCase | `<PackCard />`, `<TreeView />` |
| Hooks | `Use` + PascalCase | `UseCart`, `UseAuth` |
| CSS classes | Tailwind v4 utility | `className="flex items-center..."` |

> **استثناء**: أسماء ملفات Next.js المطلوبة بالإطار تبقى كما هي: `page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx`, `route.ts` — ولا تُغيَّر لـ PascalCase.

---

## Server vs Client Components

- **Server Component**: الافتراضي — لا `"use client"`
- **Client Component**: فقط عند الحاجة الفعلية:
  - Event handlers (`onClick`, `onChange`, etc.)
  - React hooks (`useState`, `useEffect`, etc.)
  - Browser APIs (`window`, `localStorage`, etc.)
  - Animations / real-time updates
- لا تحول component لـ Client بدون سبب واضح

---

## File Conventions (App Router)

| ملف | الدور |
| --- | --- |
| `page.tsx` | Route entry — Server Component |
| `layout.tsx` | Shared layout (لا يُعاد render إلا عند الحاجة) |
| `loading.tsx` | Suspense boundary — skeleton أو spinner |
| `error.tsx` | Error boundary — Client Component |
| `route.ts` | API route handler |
| `middleware.ts` | Edge middleware (auth, locale redirect) |
| `not-found.tsx` | 404 page |

---

## PageContent Responsibilities

**مسموح فقط:**

- استدعاء hooks
- تمرير props للـ components
- تنسيق بنية الصفحة العامة
- ربط الأحداث العالية المستوى

**ممنوع داخل PageContent:**

- تعريف components — حتى components صغيرة
- تعريف types أو interfaces
- helper functions كبيرة
- business logic
- تكديس `useState` أكثر من 3 states مترابطة → custom hook

---

## State Management

```
1-2 useState               → مقبول في component
3+ مترابطة                → custom hook في _hooks.ts
مشتركة بين صفحات          → Zustand store
Server state (cache)       → Apollo Client / SWR
Form state                 → React Hook Form
```

---

## Data Fetching

- **Server Components**: native `fetch()` + `cache` / `next: { revalidate: N }`
- **Client Components**: `ApolloCSRClient.query/mutate` أو `useLazyQuery/useMutation`
- **SSR**: `GetSSRClient()` في Server Components
- لا `getServerSideProps` / `getStaticProps` — App Router فقط
- Types: استخدم `Generated.ts` — لا تعريف يدوي لـ GraphQL responses

---

## Styling — Tailwind CSS v4 (CSS-First)

```css
/* ✅ صحيح — v4 */
@import "tailwindcss";

@theme {
  --color-bg-primary: var(--color-bg-primary);
  --color-accent-sky: #2176ae;
  --radius-md: 8px;
}

/* ❌ ممنوع — v3 syntax */
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- لا `tailwind.config.ts` — v4 CSS-first
- CSS custom properties لكل token — لا hardcoded colors
- `data-theme` على `<html>` لتبديل الـ themes: `dark-navy` | `light` | `navy-branded`
- Theme يُحفظ في `localStorage` — لا flash عند التحميل

---

## RTL Support — MANDATORY

- **CSS Logical Properties فقط** — لا `margin-left`, `padding-right`, `left`, `right`

| ممنوع | بديله |
| --- | --- |
| `margin-left` | `margin-inline-start` |
| `padding-right` | `padding-inline-end` |
| `left: 0` | `inset-inline-start: 0` |
| `text-align: right` | `text-align: end` |

- `<html dir="rtl|ltr" lang="ar|en">` بناءً على اللغة
- Tailwind RTL variants: `rtl:` و `ltr:` عند الضرورة فقط

---

## i18n

- Route prefix: `/en/...` و `/ar/...`
- كل text ظاهر = i18n key — لا hardcoded strings
- Translation files: `I18n/Locales/En.ts` و `Ar.ts`
- Default locale: English (en)

---

## Optimistic UI — MANDATORY

كل mutation (create, update, delete, reorder) يجب أن:

1. **تُحدِّث الـ UI فوراً** قبل انتظار response السرفر
2. عند الفشل: **rollback** للحالة السابقة + رسالة خطأ
3. لا loading state يمنع المستخدم من التفاعل أثناء انتظار الـ API

---

## Performance

- `next/image` لكل الصور — لا `<img>` مباشر
- `next/font` لكل الـ fonts — self-hosted، preloaded
- Dynamic imports للـ heavy components: `dynamic(() => import(...))`
- Target: LCP < 2.5s, CLS < 0.1, INP < 200ms, PageSpeed Mobile ≥ 85

---

## SEO — MANDATORY للصفحات العامة

```typescript
export const metadata: Metadata = {
    title: '...',
    description: '...',
    openGraph: { title: '...', description: '...', images: ['...'] },
    alternates: { languages: { 'ar': '/ar/...', 'en': '/en/...' } },
};
```

- Schema.org: `Product`, `BreadcrumbList`, `Organization`, `FAQPage`
- hreflang: ar ↔ en alternates
- `App/sitemap.ts` — dynamic
- `App/robots.ts` — disallow `/admin/` و `/api/`

---

## Code Quality — Checklist

```txt
[ ] PascalCase naming for ALL identifiers
[ ] File header comment explaining purpose
[ ] Component/Function JSDoc comments
[ ] Inline comments للـ complex logic
[ ] لا any types — استخدم unknown + narrowing
[ ] Max 600 lines per file
[ ] كل text عبر i18n keys — لا hardcoded strings
[ ] RTL tested: CSS Logical Properties
[ ] 3 states handled: Loading, Error, Empty
[ ] GraphQL: Generated.ts types — لا manual types
[ ] Theme tokens — لا hardcoded colors
[ ] Mobile First → Desktop
[ ] WCAG AA: aria-labels, keyboard nav, contrast ≥ 4.5:1
[ ] Server Component by default, "use client" عند الضرورة فقط
[ ] next/image لكل الصور
[ ] next/font لكل الـ fonts
[ ] Tailwind v4: @import "tailwindcss" + @theme{}
[ ] Optimistic UI لكل mutations
[ ] PageContent ≤ 300 سطر
[ ] bun run typecheck يمر بدون أخطاء
```

---

## File Size Limit — MANDATORY

> **ممنوع أي ملف يتجاوز 600 سطر مطلقاً.**

إذا تجاوز → قسّم حسب المسؤولية:

- `TreeView.tsx` → `TreeView.tsx` (orchestration) + `TreeNode.tsx` + `TreeControls.tsx`
- `PageContent.tsx` → افصل sections لـ components مستقلة

**مستثنى:** Config files, Type definition files

---

## Typecheck

```bash
bun run typecheck    # من داخل Client/
```
