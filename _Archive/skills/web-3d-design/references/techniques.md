# Techniques

How to do the things the templates don't do out of the box, and how the templates are put together.

## Contents
- R3F template anatomy
- The scroll-stop choreography pattern
- Loading a GLTF model
- Glass and transmission
- Post-processing
- Single-file three.js (and porting to it)
- CSS 3D and scroll-driven CSS (no WebGL)
- Spline and other editors
- Video backgrounds

---

## R3F template anatomy

```
src/
  main.tsx                 fonts (@fontsource, self-hosted) + styles + root
  index.css                Tailwind 4, @theme fonts, .liquid-glass, focus ring
  App.tsx                  glow layer, lazy <Scene>, nav, sections
  hooks/useScrollStops.ts  continuous section index from [data-stop] elements (ref, no re-renders)
  hooks/usePointer.ts      pointer -1..1 from window events (canvas stays pointer-events: none)
  hooks/useReducedMotion.ts
  scene/Scene.tsx          <Canvas>, PerformanceMonitor → DPR, no-WebGL CSS fallback
  scene/Studio.tsx         Lightformer environment (no HDR download)
  scene/HeroObject.tsx     poses per section, sampling, damping, the mesh + material
  sections/*.tsx           Nav, Hero, Issues, Join, EmailForm
```

The scene chunk is `lazy()`-loaded, so HTML text paints before three.js arrives. `vite.config.ts` splits three into its own cached chunk.

## The scroll-stop choreography pattern

1. Mark each section with `data-stop`. Their vertical centers are measured (and re-measured on any body resize).
2. On scroll, the viewport center is converted to a continuous index: `1.4` means 40% of the way from section 1's center to section 2's.
3. Each frame, the object's target pose is sampled from the pose array at that index, eased with smoothstep, and the object damps toward it (`THREE.MathUtils.damp`, λ ≈ 3.5; frame delta capped at 0.1 s so a background tab doesn't cause a jump).
4. Idle rotation and pointer tilt are added on top of the target, not into the poses.

This keeps scrolling native (no scroll hijacking, works with keyboard, find-in-page, and anchor links), unlike drei `ScrollControls`, which replaces the page's scrolling with its own container. Use `ScrollControls` only for a full-screen experience with no normal page content.

## Loading a GLTF model

```tsx
import { useGLTF } from "@react-three/drei";
const { nodes, materials } = useGLTF("/models/product.glb", "/draco/"); // local Draco decoder path
useGLTF.preload("/models/product.glb", "/draco/");
```

- **Compress first**: `npx @gltf-transform/cli optimize in.glb out.glb --compress draco --texture-compress webp`. Aim for under ~2 MB for a hero model.
- **Host the Draco decoder yourself.** By default drei fetches it from `www.gstatic.com`, which fails offline and under strict CSPs. Copy `node_modules/three/examples/jsm/libs/draco/` to `public/draco/` and pass that path.
- Generate typed JSX for a model with `npx gltfjsx model.glb --types` and edit the result like any component.
- Wrap model components in `<Suspense>` with a fallback that keeps the layout (the CSS stand-in or nothing).
- Center and scale with drei `<Center>` and `<Bounds>` instead of guessing numbers per model.

## Glass and transmission

- drei `MeshTransmissionMaterial` refracts what is behind it in the 3D scene, not the HTML page. Put other geometry behind the glass object (a colored shape, a gradient plane, a second object) or it renders as an almost invisible outline.
- It renders the scene an extra time per frame. On phones use `samples 4, resolution 256`, or switch to plain `MeshPhysicalMaterial` with `transmission 1`.
- For glass UI over the scene, use CSS `.liquid-glass` (backdrop blur of the canvas behind it). It's cheap and stays crisp.

## Post-processing

`@react-three/postprocessing` 3.x (for R3F 9 / React 19):

```tsx
<EffectComposer multisampling={0}>
  <Bloom mipmapBlur intensity={0.6} luminanceThreshold={0.85} />
  <Vignette offset={0.3} darkness={0.6} />
</EffectComposer>
```

Use bloom only with emissive accents or very bright highlights; it costs a full-screen pass or more. Skip it on phones (gate on `PerformanceMonitor`). Chromatic aberration and noise age badly; leave them out unless the brand is explicitly glitchy.

## Single-file three.js (and porting to it)

`assets/single-file/index.html` is the same page without React or a build:

- three and its addons load through an import map from `cdn.jsdelivr.net/npm/three@<version>/`, which is on the allow-list for published claude.ai pages. Keep the version pinned in both entries.
- drei doesn't exist here: the environment is `RoomEnvironment` plus two tinted `MeshBasicMaterial` panels, run through `PMREMGenerator.fromScene`. The material, poses, sampling, and damping are identical to the R3F version.
- No-WebGL: the renderer is created in a `try`; on failure the canvas is removed and the page is complete without it.
- Porting a change from the R3F template: copy the pose arrays (flattened to `[x, y, z, rx, ry, rz, scale]`), the material props, and any light color changes.

If the scene doesn't appear after publishing, check the browser console for blocked requests first; any script host outside the allow-list fails silently.

## CSS 3D and scroll-driven CSS (no WebGL)

For "some depth" without a scene, which is also a good fallback layer:

- **Tilt cards:** `perspective: 900px` on the parent, `transform: rotateX() rotateY()` from pointer position on the child, `transform-style: preserve-3d` for layered children at different `translateZ`.
- **Scroll parallax with CSS only:** a `view-timeline` on the wrapper, and each layer runs `animation: parallax linear both; animation-timeline: --wrapper;` with a different `translateY` in its keyframes. Guard with `@supports (animation-timeline: view())` and turn it off under `prefers-reduced-motion`.
- CSS 3D is limited to flat planes: it can't shade, reflect, or render curved objects. Use it for UI depth, not for a hero object.

## Spline and other editors

A Spline scene exported as an embed pulls the Spline runtime and assets from Spline's servers: large, external, and fragile under CSPs. Prefer exporting from the editor (Spline, Blender) as GLTF and loading it with the pattern above, or rendering a short loop to video for the video technique.

## Video backgrounds

When the 3D comes from a pre-rendered clip (Blender render, an AI-generated shot, a product film), use `assets/video-hero/` and read `references/video-hero.md`. Tell the user the page's depth depends on that file: if the video fails to load, nothing 3D remains, so give it a `poster` image and a dark background.
