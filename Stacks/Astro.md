# Astro Stack

## Setup

- `bun create astro@latest` أو `npm create astro@latest`
- Config: `astro.config.mjs`
- Dev: `bun run dev` / `npm run dev`
- Build: `bun run build`

## Core Concept — Islands Architecture

```
Astro component (.astro)  → Zero JS بالافتراضي (pure HTML/CSS)
Framework component       → Island — تُحمَّل JS فقط عند الحاجة
Static content            → لا JS يُرسل للـ client
```

## Output Modes

| الوضع | متى تستخدمه |
| --- | --- |
| `output: 'static'` | SSG — كل الصفحات pre-rendered |
| `output: 'server'` | SSR — كل الصفحات server-rendered |
| `output: 'hybrid'` | Mixed — بعض الصفحات static وبعضها dynamic |

## Component Types

```astro
---
// Astro frontmatter — يُنفَّذ server-side فقط
import SomeComponent from './SomeComponent.astro';
const data = await fetch('/api/data').then(r => r.json());
---

<!-- Template — HTML + expressions -->
<main>
  <h1>{data.title}</h1>
  <SomeComponent title="Hello" />
  
  <!-- Island: يُحمَّل React/Vue/Svelte component مع JS -->
  <ReactCounter client:load />
  <HeavyChart client:idle />
  <LazyModal client:visible />
</main>
```

## Client Directives (Islands)

| Directive | متى تُحمَّل |
| --- | --- |
| `client:load` | فوراً عند تحميل الصفحة |
| `client:idle` | بعد انتهاء الـ loading |
| `client:visible` | عند دخول الـ viewport |
| `client:media="(max-width: 768px)"` | عند تطابق media query |
| `client:only="react"` | Client-only — لا SSR |

## Content Collections

```typescript
// src/content/config.ts
import { defineCollection, z } from 'astro:content';

const blog = defineCollection({
    schema: z.object({
        title: z.string(),
        date: z.date(),
        tags: z.array(z.string()),
    }),
});

export const collections = { blog };
```

```astro
---
// استخدام في صفحة
import { getCollection } from 'astro:content';
const posts = await getCollection('blog');
---
```

## Routing

- File-based routing: `src/pages/` → URL
- Dynamic routes: `src/pages/[slug].astro`
- `Astro.params.slug` للحصول على الـ params
- API routes: `src/pages/api/endpoint.ts` → Response

## Styling

- Scoped CSS بالافتراضي في `.astro` components: `<style>` → CSS modules-like
- Global CSS: `<style is:global>`
- Tailwind: `@astrojs/tailwind` integration

## Integrations

```javascript
// astro.config.mjs
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
    integrations: [react(), tailwind(), sitemap()],
    site: 'https://mysite.com',
});
```

## Common Gotchas

- Astro components لا يمكنها استخدام React hooks — استخدم React component كـ Island
- `import.meta.env` للـ env variables — لا `process.env`
- Public env: `PUBLIC_` prefix → يُكشف للـ client
- Private env: بدون prefix → server-only
- لا `window` / `document` في Astro frontmatter — server-side فقط
