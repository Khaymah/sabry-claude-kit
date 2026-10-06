---
name: web-3d-design
description: Design and build 3D websites and 3D web experiences, not just flat pages. Covers choosing the technique (React Three Fiber project, single-file Three.js page, pre-rendered 3D video background, CSS 3D), art direction for a hero 3D object (shape, materials, studio lighting with no HDR downloads), scroll-driven choreography where the object moves between page sections, liquid-glass UI over the scene, performance budgets, reduced-motion and no-WebGL fallbacks, and a mandatory headless-browser render check with screenshots. Ships a verified R3F site template, a single-file Three.js template and a video-hero template. Use whenever the user wants a 3D website, 3D landing page or hero, Three.js, React Three Fiber, WebGL, an immersive or cinematic site, a 3D product showcase, scroll-based 3D animation, glassmorphism over 3D, or a video-background hero, including Arabic requests like موقع 3D or تصميم ويب ثلاثي الأبعاد, even if they only say make it 3D.
---

# Web 3D design

Build websites where a real 3D scene is part of the design: a hero object that is lit, has depth, and moves through the page as the reader scrolls, with normal HTML content and glass UI on top. The goal is a page that feels three-dimensional and still reads, loads, and works like a website.

A page only counts as 3D if the 3D survives on its own. If the depth comes entirely from one external video or image, the page is a frame around someone else's render: say so, and prefer live 3D unless the user asked for the video look.

## Files in this skill

| Path | Use it when |
|---|---|
| `assets/r3f-site/` | Default. Vite + React 19 + React Three Fiber 9 + drei 10 + three 0.186 + Tailwind 4, self-hosted fonts. A three-section site whose iridescent ring moves between sections on scroll. Builds and renders as-is. |
| `assets/single-file/index.html` | No build step: a quick page, a claude.ai published artifact, or a prototype. Plain three.js from jsDelivr via an import map, same scene and choreography. |
| `assets/video-hero/` | The user wants a pre-rendered 3D video behind glass UI (the "cinematic hero" spec). Vite + React 18 + Tailwind 3, exactly as that spec requires. |
| `references/art-direction.md` | Before choosing the object, material, lighting, colors, or poses. Read it for every new design. |
| `references/techniques.md` | Loading GLTF models, glass/transmission, post-processing, CSS 3D and scroll-driven CSS, Spline, porting the scene to the single-file version. |
| `references/performance-a11y.md` | Budgets, DPR, mobile, lazy loading, reduced motion, fallbacks, focus and contrast over 3D. |
| `references/video-hero.md` | The video technique: exact spec, the JS fade loop, liquid glass CSS, verified pitfalls. |
| `scripts/verify_render.py` | Always, before delivering. Renders in headless Chromium with WebGL, screenshots every section, fails on blank canvas, errors, or failed requests. |

## Step 1 — Pick the technique

| Technique | Choose it when | Cost |
|---|---|---|
| **R3F project** (`r3f-site`) | A real site or product page that will be maintained; the user works in React; interaction or scroll choreography matters | ~190 kB gzip for three, plus a build |
| **Single-file three.js** (`single-file`) | The user wants something to open or publish right now, no toolchain; or the output is a claude.ai artifact | Same runtime weight, no build, fewer helpers (no drei) |
| **Pre-rendered 3D video** (`video-hero`) | Photoreal or complex scenes a browser can't render live (liquids, characters, AI-generated shots); the user supplies or wants a video | Heavy download, no interaction, depth is baked in |
| **CSS 3D + scroll-driven CSS** | Only "a bit of depth": tilted cards, layered parallax, a flipping panel. No WebGL | Tiny; see `references/techniques.md` |

When in doubt, use the R3F project for sites and the single file for quick deliverables. Mixing is fine: a video hero can lead into R3F sections.

In claude.ai specifically: the React artifact preview only has three r128 and no R3F, so don't try to run the R3F template there. Publish the single-file page instead, or deliver the R3F project as files.

## Step 2 — Design plan before code

Write a short plan and check it against the brief before touching the template. Read `references/art-direction.md` first.

1. **The object.** One hero object that comes from the subject (a coffee brand is not a chrome donut). It must look different as it rotates; a shiny sphere looks identical from every angle, so all choreography on it is invisible.
2. **Material and light.** Pick a material recipe and a lighting setup from the reference. Lighting must be asymmetric.
3. **Palette.** 4–6 hex values. The object carries most of the color; UI stays neutral.
4. **Type.** A display face and a text face, chosen for the subject.
5. **Choreography table.** One row per page section: where the object sits, how it's turned, its scale, where the text goes. Then the same table for portrait phones.

```
section    object pos        rotation (x,y,z)     scale   text zone
hero       center, low       tipped toward view   0.82    top center
issues     right half        three-quarter view   0.90    left column
join       small, top        tipped again         0.55    bottom center
```

## Step 3 — Build

1. Copy the template (`cp -r assets/r3f-site ./site && cd site && npm install`). Bun and pnpm work too.
2. Replace the object in `src/scene/HeroObject.tsx` and its `DESKTOP` / `PORTRAIT` pose arrays with your choreography table. Each `[data-stop]` section in the DOM maps to one pose, in order; the scroll hook interpolates between them with an ease, so sections can be any height.
3. Tune `src/scene/Studio.tsx` (Lightformer environment) for the material you chose. No HDR downloads: remote environment presets fail offline, in sandboxes, and under strict CSPs.
4. Write the DOM sections with real copy. All content lives in HTML; the canvas is `aria-hidden` and `pointer-events: none`, and pointer/scroll reach the scene through refs, so no React re-render happens per scroll event.
5. Keep the built-in safety nets: reduced motion (no idle drift, poses jump instead of easing), a no-WebGL CSS stand-in shaped like the object, `PerformanceMonitor` lowering DPR, lighter geometry on phones, and the scene chunk lazy-loaded after the text.

## Step 4 — Verify (mandatory)

Do not describe a 3D page as working, or show screenshots of it, until this step is done. Numbers catch a blank or crashed scene; only looking catches an ugly one.

```bash
npm run build && npx vite preview --port 4173 &          # or serve the single file
python scripts/verify_render.py http://localhost:4173 --out shots-layout --reduced-motion
python scripts/verify_render.py http://localhost:4173 --out shots-look
```

- **Two runs, two questions.** Headless software WebGL often runs at 1–5 fps, so eased motion can be caught mid-transition. The `--reduced-motion` run puts the object at each section's final pose: judge layout and overlap from it. The normal run shows materials and motion state: judge the look from it.
- **Open `contact_sheet.png` and look at every frame.** Check: the object reads as 3D and as the intended shape, no text sits on a bright highlight, nothing collides with the nav, mobile poses clear the copy, the fallback looks intentional.
- **Test the fallback** at least once: launch Chromium with `--disable-webgl --disable-3d-apis` and confirm the CSS stand-in shows with no page errors.
- **Hosts blocked in your sandbox** (Google Fonts, a CDN, a video host) will fail the run. Pass them with `--ignore-hosts` and state plainly in your reply what could not be rendered. Never substitute a stand-in asset (a test video, a placeholder model) and then present those screenshots as the design; show them only if clearly labelled as a layout check.
- If the check fails, fix and re-run before replying.

## Rules learned the hard way

Each of these broke a real render while building this skill.

- **Shape must change under rotation.** Mirror spheres hide rotation completely. Rings, knots, twisted or asymmetric forms, or models with a clear front all read.
- **No symmetric lights and no ring light facing the camera.** On a shiny object they reflect as two eyes and a pupil: the object looks like a face.
- **Re-measure sections when the page resizes.** Web fonts change section heights after first paint; measure once and the object lands between sections. Use a `ResizeObserver` on `body`.
- **Mind library breaking changes.** lucide-react 1.x removed brand icons (Instagram, Twitter); drei 10 and R3F 9 need React 19; drei 9 and R3F 8 need React 18. The templates pin working sets.
- **Glass needs something behind it.** Transmission and backdrop blur over empty black look like nothing. Put glass UI over the 3D object, and glass materials in front of other geometry.

## Arabic and RTL

- `dir="rtl"` on `<html>`; mirror the choreography by negating x in the poses (`[1.55, …]` → `[-1.55, …]`) so the object sits opposite the text column.
- Instrument Serif and Geist have no Arabic glyphs. Pair an Arabic display face (for example Amiri, Reem Kufi or El Messiri) with IBM Plex Sans Arabic for text, self-hosted via `@fontsource`. Remove negative letter-spacing on Arabic; it breaks the joins.
- Swap `pl-*`/`pr-*` for `ps-*`/`pe-*`, and mirror directional icons (arrows), not symmetric ones.

## Delivery checklist

- [ ] One hero object from the subject, readable under rotation; asymmetric lighting, no HDR downloads.
- [ ] Choreography table implemented for desktop and portrait; text never sits on the object's brightest area.
- [ ] Content in the DOM; canvas `aria-hidden`, `pointer-events: none`; visible focus rings.
- [ ] Reduced motion, no-WebGL fallback, DPR cap, lighter phone geometry, lazy-loaded scene.
- [ ] `verify_render.py` passes in both modes; contact sheet viewed; anything that couldn't render is named in the reply.
