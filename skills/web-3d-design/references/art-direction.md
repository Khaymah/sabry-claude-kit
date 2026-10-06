# Art direction for 3D websites

What separates a 3D page that looks designed from one that looks like a demo. Read this before choosing the object, material, lighting, or poses.

## Contents
- The hero object
- Materials (recipes with numbers)
- Lighting without HDR files
- Background and depth
- Camera
- Composition and choreography
- Color
- Motion
- Type and UI over 3D
- What reads as cheap

---

## The hero object

One object carries the page. More objects dilute it and cost frame time.

- **Derive it from the subject.** A newsletter about ideas can be an abstract ring ("turning something over"); a coffee brand wants a bean, cup, or pour; a fintech product a coin, card, or stacked forms; a developer tool a stylized key, cube, or terminal slab. Ask what the product's world is made of before reaching for an abstract blob.
- **It must read under rotation.** The page moves the object between sections, so its silhouette and reflections must change as it turns. A mirror sphere looks the same from every angle and makes choreography invisible. Rings, tori with thick tubes, knots, rounded extruded shapes, and models with a clear front all work.
- **Silhouette test.** Fill the object black in your head: if the outline alone is recognizable and interesting from at least two of your poses, it will hold up.
- **Primitives vs models.** Primitives (torus, rounded box, capsule, extruded SVG path) need no download and always load. A GLTF model is right when the subject is a real thing (a product, a character); see `techniques.md` for loading and compression.

## Materials (recipes with numbers)

All are `MeshPhysicalMaterial` props (drei's `MeshDistortMaterial` accepts the same plus `distort`/`speed`).

| Look | Recipe | Notes |
|---|---|---|
| Iridescent chrome (template) | `metalness 0.92, roughness 0.2, iridescence 1, iridescenceIOR 1.35, iridescenceThicknessRange [100, 900], clearcoat 1, clearcoatRoughness 0.12, envMapIntensity 1.3` | Lives entirely on its reflections; needs the Lightformer studio. Roughness under ~0.12 turns every light into a hard-edged shape. |
| Polished metal, single tone | `metalness 1, roughness 0.25, color` = the metal (gold `#e6c07a`, copper `#d08a5c`) | Warmer, more "product". Pair with warm key light. |
| Satin plastic / ceramic | `metalness 0, roughness 0.45, clearcoat 0.6, clearcoatRoughness 0.3, color` = brand color | Friendly and legible; shows form through shading, not reflections. Best for colored objects. |
| Matte clay | `metalness 0, roughness 0.85, color` light neutral | Calm, editorial. Needs a directional key light plus the environment, or it goes flat. |
| Clear glass | drei `MeshTransmissionMaterial`: `transmission 1, thickness 0.6, roughness 0.05, ior 1.45, chromaticAberration 0.03, samples 6, resolution 512` | Only works with something behind it in the 3D scene to refract. Over empty black it disappears. Costly: one extra render per frame. |
| Frosted glass | as clear glass with `roughness 0.35, thickness 1.2` | Softer, cheaper-looking at low `samples`; keep `samples ≥ 6`. |
| Emissive / neon | `emissive` = color, `emissiveIntensity 2–4`, plus bloom | Only with post-processing bloom, and only for small accents. |

Distortion (`MeshDistortMaterial`) reads as "liquid"; keep `distort ≤ 0.25` on shapes with holes or it tears the silhouette, and `speed ≈ 1`.

## Lighting without HDR files

Use an environment map built in the scene from drei `Lightformer`s (R3F) or `RoomEnvironment` plus tinted panels (plain three.js). Remote HDR presets break offline, in sandboxes, and under CSP.

- **Asymmetric.** Key light on one side, rim on the other side and behind, a soft top panel, a faint floor bounce. Mirror-symmetric lights reflect as a pair of eyes.
- **No ring or small bright shape facing the camera.** It reflects dead center as a pupil. Use broad rectangles.
- **Broad panels, moderate intensity.** Big soft rectangles (scale 5–14) give smooth gradients; small intense ones give hard blobs.
- **Tint deliberately.** Cool key (`#a9c8ff`) and warm rim (`#ffb8d2`) give chrome its two-tone edge; a low-intensity floor bounce (0.5) adds a third hue. Raising the bounce saturates the whole object quickly; 0.9 already made the template read as generic violet.
- **Set the environment background** (`<color attach="background" args={["#070812"]} />` inside `Environment`) to a very dark tint so the non-lit parts of reflections aren't pure black holes.
- Matte materials also need a real light (`directionalLight` at intensity 1–2) because they don't show the environment much.

## Background and depth

- Black page, a soft radial glow behind where the object sits (CSS, behind a transparent canvas). The glow separates a dark object from a dark page and costs nothing.
- For multi-object scenes, add `fog` so far objects fade into the background color.
- Grounded objects (products on a surface) get `ContactShadows`; floating ones don't need a floor.

## Camera

- Field of view 30–40° for products and hero objects; wider exaggerates perspective and looks like a phone photo.
- Keep the camera still and move the object. One moving thing is easier to choreograph and never makes people seasick. Camera moves are for scenes with an environment to travel through.
- At `z = 6, fov 35` the visible height is about 3.78 units: y = ±1 is roughly a quarter of the screen from center. Use that to place objects against the layout.

## Composition and choreography

- Each section splits the screen into an **object zone** and a **text zone**, and they must not overlap on the object's bright side. Typical sequence: hero (object low, text top) → feature (object to one side, text column opposite) → closing (object small, above the call to action).
- Show a **different face** of the object in each section: tipped toward the viewer, three-quarter, edge-on. Rotation differences of at least ~0.5 rad per axis between poses are visible; smaller ones read as jitter.
- **Portrait phones get their own poses**: object centered above the text, scale ~0.4–0.5, and copy pushed down (`margin-top: ~34svh`) so they don't collide.
- Ease between poses with smoothstep, then damp toward the target each frame (λ ≈ 3.5). Linear interpolation looks mechanical.

## Color

- The object is the color. UI stays white and translucent white; one solid white primary button is enough.
- Avoid the default violet-to-pink "AI gradient" unless the brand is that. Tint lights toward the brand instead.
- Test the palette on the object itself: reflections mix light colors, so a small tint change shifts the whole object.

## Motion

- **One arrival.** On load the object eases from ~70% scale to its first pose. No other load animations.
- **Scroll is the main motion.** Everything else is secondary.
- **Idle:** ≤ 0.12 rad/s rotation. **Pointer tilt:** ≤ 0.15 rad on x, ≤ 0.25 rad on y.
- **Reduced motion:** no idle, no pointer tilt, no distortion animation; the object follows scroll by jumping to poses.

## Type and UI over 3D

- A display face with character for headlines (Instrument Serif in the template) and a clean text face (Geist). Two families, clearly different.
- Headlines use `text-wrap: balance` so they never leave one word on a line.
- Text never sits on the object's highlight side; check every section in the contact sheet.
- Liquid glass (`.liquid-glass`) reads as glass only when the scene moves behind it: put the nav, inputs, and small buttons there, not whole sections.

## What reads as cheap

- A default mirror ball or plain torus knot with no lighting work.
- Symmetric reflections, "eyes", visible hard light shapes on the object.
- Multiple objects all spinning at the same speed.
- Objects that drift constantly with nothing to do with scroll.
- Heavy bloom and chromatic aberration everywhere.
- 3D text as the headline (hard to read, bad for SEO and screen readers).
- A black page with a small object floating in the middle and no glow or depth cue.
