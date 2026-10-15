# Performance, accessibility, and fallbacks

A 3D page that stutters on a mid-range phone, hides its content from screen readers, or goes blank without WebGL is a worse page than a flat one. These are the floors.

## Budgets

| Item | Desktop hero | Phone |
|---|---|---|
| Triangles in view | ≤ 200k | ≤ 50k |
| Draw calls | ≤ 50 | ≤ 20 |
| Textures | ≤ 2048 px, compressed (WebP/KTX2) | ≤ 1024 px |
| Device pixel ratio | cap at 2 | cap at 1.5, drop to 1 on decline |
| JS for 3D | three ≈ 190 kB gzip + scene | same; lazy-load it |
| Transmission / post passes | ≤ 1 | 0 |

The template's torus is 96×192 segments on desktop (~37k triangles) and 48×96 on portrait screens.

## Techniques that keep it fast

- **Lazy-load the scene** (`lazy(() => import("./scene/Scene"))`) so text and layout paint first; three.js arrives after.
- **Cap DPR and adapt it**: `dpr={Math.min(devicePixelRatio, 1.5)}` to start, then drei `<PerformanceMonitor onIncline={→2} onDecline={→1}>`.
- **Render only when needed** for static scenes: `frameloop="demand"` and call `invalidate()` on scroll/pointer. The template animates continuously, so it keeps `"always"`; the browser pauses rAF in background tabs.
- **Pause offscreen** if the canvas is not full-page fixed: stop the loop when an `IntersectionObserver` reports it out of view.
- **One environment render**: `<Environment frames={1}>` bakes the Lightformers once instead of every frame.
- **Refs, not state**, for anything that changes per frame or per scroll event. Setting React state on scroll re-renders the tree 60 times a second.
- **Keep backdrop blur small** (4 px) and on small elements; large blurred areas over a live canvas are expensive on phones.

## Accessibility

- All content is HTML. The canvas has `aria-hidden="true"` and carries no information that isn't also in the DOM.
- `pointer-events: none` on the canvas wrapper so it never swallows clicks, taps, or text selection.
- Visible `:focus-visible` rings on every control (the template sets a global one).
- **Reduced motion** (`prefers-reduced-motion: reduce`): no idle rotation, no pointer tilt, no distortion animation, no eased transitions. The object still follows scroll, jumping straight to each section's pose. That keeps the design intact without drifting motion.
- **Contrast**: body text over the scene needs the same contrast as over a flat background. Keep text zones away from the object's highlights; check in the contact sheet, not by assumption.
- Headlines as real `<h1>`/`<h2>` text, never 3D text meshes.

## Fallbacks

- **No WebGL** (old devices, disabled GPU, some enterprise browsers): detect before mounting (`canvas.getContext("webgl2") || getContext("webgl")`) and render a CSS stand-in with the object's shape and colors in its first position. The template's is a masked conic-gradient ring. Test it with Chromium flags `--disable-webgl --disable-3d-apis`.
- **Context lost** (GPU reset, too many tabs): R3F and three.js recover in most cases; if the scene matters, listen for `webglcontextlost` on the canvas and show the CSS stand-in until `webglcontextrestored`.
- **Slow networks**: the lazy scene plus self-hosted fonts means the page is readable before 3D loads. For GLTF models, the Suspense fallback should keep the layout, not show a spinner in the middle of the hero.

## Measuring

- The bundled `scripts/verify_render.py` checks that it renders; it does not measure real-device speed (headless software WebGL runs at 1–5 fps regardless).
- For speed, open the built site in Chrome DevTools with CPU throttling ×4 and the Performance panel, or use drei `<Perf>` / `r3f-perf` during development to watch frame time, draw calls, and triangles.
