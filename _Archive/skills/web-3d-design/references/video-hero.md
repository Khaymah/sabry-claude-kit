# Video hero — liquid glass over a pre-rendered 3D video

A single-screen hero: a full-viewport background video that loops through a JavaScript fade, "liquid glass" pill controls floating on top, and an Instrument Serif headline. All of the depth comes from the video file, which is usually a 3D render or an AI-generated 3D shot. The code itself contains no 3D: if the video fails to load, nothing 3D remains. Give it a `poster` frame and say this to the user when it matters.

## Contents
- Quick start
- Template file map
- Exact spec (layers, video, fade loop, liquid glass, nav, hero, footer, font)
- Adapting it (copy, video, brand, sections below the fold)
- Arabic and RTL
- Pitfalls (all verified in a real build)
- Checklist

---

## Quick start

The template in `assets/video-hero/` is a complete Vite + React 18 + TypeScript + Tailwind 3 project. It builds cleanly with `tsc --noEmit && vite build`.

```bash
cp -r <skill>/assets/video-hero ./my-hero && cd my-hero
npm install        # or: pnpm install / bun install
npm run dev
```

For an existing project, copy only what it lacks: `src/index.css` (move the font `@import` to the very top of the global stylesheet and the `.liquid-glass` block into `@layer components`), `src/hooks/useVideoFade.ts`, `src/components/BackgroundVideo.tsx`, `src/components/HeroSection.tsx`.

For a claude.ai React artifact (no build step): inline the `.liquid-glass` CSS in a `<style>` tag inside the component, inline the hook, and replace the `<form>` with a `<div>` plus an `onClick` on the submit button, because artifacts don't allow form tags. For a published HTML page, port to plain JS; the fade logic is framework-free apart from refs.

## Template file map

| File | Role |
|---|---|
| `src/index.css` | Google Font `@import` (first line), Tailwind directives, `.liquid-glass` + `::before` |
| `src/hooks/useVideoFade.ts` | The rAF fade loop. Constants `FADE_MS`, `FADE_OUT_LEAD_S`, `RESTART_DELAY_MS` at the top |
| `src/components/BackgroundVideo.tsx` | The `<video>` element, memoized; `HERO_VIDEO_SRC` constant; `src` prop to override |
| `src/components/HeroSection.tsx` | Nav, headline, email bar, subtitle, Manifesto button, social footer. Copy lives in constants at the top |
| `tailwind.config.js` | Default config, content paths only, no theme extensions (by design) |
| `package.json` | Pinned versions; `lucide-react` is pinned on purpose, see Pitfalls |

## Exact spec

### Layers

```
div  relative flex min-h-screen flex-col overflow-hidden bg-black
├─ video   absolute inset-0 h-full w-full object-cover translate-y-[17%]   (opacity driven by JS)
├─ nav     relative z-20
├─ main    relative z-10 flex-1  (hero, -translate-y-[20%])
└─ footer  relative z-10         (social icons)
```

### Background video

- Source: `https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260328_115001_bcdaa3b4-03de-47e7-ad63-ae3e392c32d4.mp4`
- `autoPlay muted playsInline`, `preload="auto"`, `aria-hidden`. **No `loop` attribute.**
- `translate-y-[17%]` moves the video box down by 17% of its own height. The parent's `overflow-hidden` clips the bottom 17%, and the top band of the viewport shows the black background behind the nav. This is intentional for this clip, whose upper frame is dark and whose interesting content sits low.

### Fade loop (JS, no CSS transitions)

1. `fadeTo(target)` animates `video.style.opacity` over 500ms with `requestAnimationFrame`, linear.
2. Every call cancels the running frame first, so fades never compete.
3. It starts from the current opacity (parsed from `style.opacity`), so interrupting a fade doesn't snap.
4. `loadeddata` → reset `fadingOutRef`, `play()`, fade to 1.
5. `timeupdate` → when `duration - currentTime <= 0.55` and `fadingOutRef` is false, set it true and fade to 0. The ref stops the later `timeupdate` events from restarting the fade.
6. `ended` → cancel any fade, set opacity 0, wait 100ms, `currentTime = 0`, `play()`, reset the ref, fade to 1.
7. Unmount → cancel the frame and clear the restart timeout.

Verified with a 4s test clip in headless Chromium: 0→1 in ~500ms after `loadeddata`; fade-out begins in the last 0.55s; opacity 0 at `ended`; restart and fade-in ~100ms later; identical on every loop.

### Liquid glass (`.liquid-glass`)

```css
background: rgba(255,255,255,0.01);  background-blend-mode: luminosity;
backdrop-filter: blur(4px);          -webkit-backdrop-filter: blur(4px);
border: none;  box-shadow: inset 0 1px 1px rgba(255,255,255,0.1);
position: relative;  overflow: hidden;

::before  position:absolute; inset:0; border-radius:inherit; padding:1.4px;
          background: linear-gradient(180deg, .45 0%, .15 20%, 0 40%, 0 60%, .15 80%, .45 100%)  /* white alphas */
          -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          -webkit-mask-composite: xor;  mask-composite: exclude;  pointer-events: none;
```

The mask paints the gradient over the whole box, then subtracts the content box, leaving only the 1.4px padding ring: a hairline that is bright at the top and bottom and invisible at the sides. The template also sets the unprefixed `mask` for Firefox. It lives in `@layer components` so Tailwind utilities like `hover:bg-white/5` still win on hover.

### Navigation

- `nav`: `relative z-20 pl-6 pr-6 py-6`
- Inner: `rounded-full px-6 py-3 flex items-center justify-between max-w-5xl mx-auto` (no glass on the bar itself; adding `liquid-glass` here is a common variation, not the spec)
- Left, `gap-8`: logo (`Globe` 24 + "Asme", white, `font-semibold text-lg`, `gap-2`), then links Features / Pricing / About, `hidden md:flex`, `text-white/80 hover:text-white transition-colors text-sm font-medium`
- Right, `gap-4`: "Sign Up" plain white text button; "Login" `liquid-glass rounded-full px-6 py-2`

### Hero

- `main`: `relative z-10 flex-1 flex flex-col items-center justify-center px-6 py-12 text-center -translate-y-[20%]`
- `h1` "Built for the curious": `text-5xl md:text-6xl lg:text-7xl text-white mb-8 tracking-tight whitespace-nowrap`, inline `fontFamily: "'Instrument Serif', serif"`
- Wrapper `max-w-xl w-full space-y-4`:
  - Email bar `liquid-glass rounded-full pl-6 pr-2 py-2 flex items-center gap-3`: transparent input (`text-white placeholder:text-white/40 text-base`, placeholder "Enter your email") + submit `bg-white rounded-full p-3 text-black` with `ArrowRight` 20
  - Subtitle `text-white text-sm leading-relaxed px-4`: "Stay updated with the latest news and insights. Subscribe to our newsletter today and never miss out on exciting updates."
  - Manifesto button, centered: `liquid-glass rounded-full px-8 py-3 text-white text-sm font-medium hover:bg-white/5 transition-colors`

### Social footer

`relative z-10 flex justify-center gap-4 pb-12`; three links `liquid-glass rounded-full p-4 text-white/80 hover:text-white hover:bg-white/5 transition-all` with `Instagram`, `Twitter`, `Globe` (20), each with an `aria-label`.

### Font

`@import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&display=swap')` as the first line of the CSS. Only the headline uses it; everything else is Tailwind's default sans stack.

## Adapting it

- **Copy and brand.** Edit the constants at the top of `HeroSection.tsx` (`BRAND`, `HEADLINE`, `SUBTITLE`, `NAV_LINKS`, `SOCIAL_LINKS`). Swap the `Globe` logo for the brand mark at 24px. Keep the headline short enough to stay on one line (about 25 Latin characters).
- **Different video.** Pass `src` to `BackgroundVideo` or change `HERO_VIDEO_SRC`. Then retune the 17% shift, because it's specific to this clip: if the new clip's top isn't dark, a black band will show, so use `translate-y-0` or `object-position` instead. Prefer a short (8–20s), muted, H.264 MP4 under ~5MB, plus a `poster` frame for slow connections.
- **Wiring the email.** `handleSubmit` is a stub; call the newsletter or waitlist API there and show success inside the bar (swap the arrow for a check) rather than a toast.
- **Sections below the fold.** The hero is exactly one screen. Following sections should stay on black with liquid-glass cards and body text at white/80, so the page doesn't break mood after the first scroll.

## Arabic and RTL

- `dir="rtl"` on the root; swap `pl-6 pr-2` on the email bar for `ps-6 pe-2`; mirror `ArrowRight` to `ArrowLeft`.
- Instrument Serif has no Arabic glyphs. Pair the headline with an Arabic display face that keeps the editorial feel (for example Amiri or Reem Kufi) and use IBM Plex Sans Arabic for body text.
- Load the Arabic families in the same Google Fonts `@import` (`...family=Instrument+Serif:ital@0;1&family=Amiri:ital,wght@0,400;1,400&family=IBM+Plex+Sans+Arabic:wght@400;500;600&display=swap`), put Amiri first in the headline's inline `fontFamily`, and set the root to `font-['IBM_Plex_Sans_Arabic',sans-serif]` so the default Tailwind config stays untouched.
- Remove `tracking-tight` on Arabic headlines; negative letter-spacing breaks the joins between Arabic letters.
- Arabic needs roughly 1.1× the size and more line height. The one-line headline rule still holds, so shorten the copy rather than letting it wrap.

## Pitfalls (all verified in a real build)

1. **lucide-react v1 removed brand icons.** `Instagram` and `Twitter` don't exist in lucide-react 1.x, so a fresh `npm i lucide-react` breaks the build. The template pins `0.577.0` (the last 0.x, which still exports them). In a project already on 1.x, draw the two brand icons as small inline SVG components instead.
2. **Never add `loop` to the video.** Native looping suppresses `ended`, so the fade system never restarts and the video jump-cuts.
3. **The font `@import` must be the first statement** in the stylesheet (before `@tailwind`), or the browser drops it silently and the headline falls back to a generic serif.
4. **The fade-out can get cut short.** Browsers fire `timeupdate` only every ~250ms, so the 0.55s trigger can land as late as ~0.3s before the end, and `ended` then snaps the remaining opacity to 0. In testing the fade reached about 0.6 before the snap. If that's visible on the real clip, raise `FADE_OUT_LEAD_S` to 0.8.
5. **`whitespace-nowrap` at `text-5xl` is tight on phones.** It measured 363px wide at a 390px viewport; below ~375px it overflows the side padding. For very narrow screens use `text-4xl` as the base size or shorten the headline.
6. **Tailwind 3, not 4.** The template uses `@tailwind` directives and a JS config. On Tailwind 4, replace the directives with `@import "tailwindcss";` (after the font import) and keep `.liquid-glass` in `@layer components`.
7. **Autoplay needs `muted` and `playsInline`** (iOS won't autoplay otherwise). Low-power mode can still block it; the first frame then stays visible, which is acceptable.
8. **Blur over video costs GPU.** Keep the blur at 4px and the glass elements small; don't turn whole sections into glass panels over the video.

## Testing it honestly

The sandbox you build in may not be able to reach the video host. Don't swap in a test clip and then show those screenshots as the design: they show layout only. Say which parts you could verify (build, layout, fade timing) and which you couldn't (how the real video looks behind the glass), and let the user check the real thing locally with `npm run dev`.

## Checklist

- [ ] Video has no `loop`; fade-in on load, fade-out near the end, restart after `ended`.
- [ ] Font `@import` is the first line of the global CSS; headline renders in Instrument Serif.
- [ ] `.liquid-glass` shows a hairline bright at top and bottom, clear at the sides.
- [ ] `lucide-react` version exports `Instagram` and `Twitter` (or inline SVGs replace them).
- [ ] Headline stays on one line at 390px; nav links hide below `md`.
- [ ] Every icon-only control has an `aria-label`; the email input has a label.
- [ ] For production, consider a focus style on the email bar (for example `focus-within:ring-1 focus-within:ring-white/30`) and pausing the video under `prefers-reduced-motion`.
- [ ] For RTL: arrow mirrored, logical padding, Arabic headline font, no negative tracking.
