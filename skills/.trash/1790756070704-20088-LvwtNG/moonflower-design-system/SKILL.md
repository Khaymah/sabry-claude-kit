---
name: moonflower-design-system
description: Design system for Moonflower Cosmetics (مون فلاور) - an Arabic-first, RTL beauty and skincare e-commerce style built on a single dusty violet (#7566A0), white sections bookended by purple header/hero/footer blocks, Tajawal typography, arched product tiles, violet-tinted card shadows, a wavy hero edge, and inverted before/after panels. Use this skill whenever the user asks to build, style, extend, or review any page or component for Moonflower, or mentions "moonflower", "مون فلاور", "the purple cosmetics design", or "the skincare landing page design"; also use it for any Arabic RTL beauty, cosmetics, or skincare storefront, landing page, product page, cart, checkout, or email template that should follow this look, and when writing Arabic product copy, prices in ج.م, or Tailwind/CSS theme files for it, even if the user doesn't name the design system explicitly.
---

# Moonflower Design System

A soft, feminine, trustworthy storefront language for an Arabic skincare brand. The page reads like a well-lit shelf: purple bookends (top bar and hero at the top, footer at the bottom) frame a calm white middle where products sit inside moon-shaped arches, benefits sit on crisp white cards with a lavender shadow, and customer stories play out in two panels whose colors invert from "before" to "after". Warmth and nature come from the photography (flowers, leaves, wood); the UI itself stays strictly violet, white, and ink.

## Files in this skill

| File | Read it when |
|---|---|
| `assets/tokens.css` | Always. Copy or inline it first. Contains the color scale, semantic aliases, type shorthands, radii, the direction-aware shadow, and utilities `.mf-card`, `.mf-arch`, `.mf-icon-disc`, `.mf-wave-bottom`, `.mf-section-title`, `.mf-latin`, `.mf-container`. |
| `assets/tailwind-preset.js` | The project uses Tailwind. Still import tokens.css for the arch, wave, and RTL shadow. |
| `references/tokens.md` | You need exact values, color roles, the contrast table, type scale rules for Arabic, or imagery guidance. |
| `references/components.md` | You're building a specific section or component, or need something the landing page doesn't show (PDP, cart, checkout, forms, badges, toasts, mobile). |
| `references/content-and-copy.md` | You're writing Arabic copy, formatting prices/percentages/phones, adding ARIA labels, or building from the original mock (it has copy errors and swapped content that must be fixed). |
| `assets/reference-landing.html` | You want working CSS or a visual target. Full landing page rebuilt from tokens with corrected copy; `reference-landing.png` is its render. Imagery is placeholder SVG, so swap in real photos. |

## The rules that make it Moonflower

1. **One hue.** Purple-500 #7566A0 does everything brand-related: header, hero, footer, icon discs, pills, avatar rings, the "after" panel. Tints (50/100/200/300) handle surfaces, borders, and shadows. The only other color in the UI is amber for rating stars. Don't introduce a secondary brand color; greens, peaches, and wood tones belong to photography.

2. **Purple bookends, white middle.** Full-width purple appears at the top (64px top bar + hero) and the bottom (footer). Everything between is white with 120px between sections. Inside the white, purple shows up only as small solid shapes or one inverted panel.

3. **The arch is sacred.** Product imagery sits in `.mf-arch` tiles (lavender fill, round top, flat bottom with a 4px purple-300 edge). Use the arch for product containers only, so it stays a signal for "this is something you can buy".

4. **Violet light from the start corner.** Cards are white with a 1px purple-100 border and a violet shadow falling down and away from the reading start (left in RTL). Never grey shadows, never shadows on text except the soft drop shadow on centered section titles.

5. **Invert to show change.** Before/after, problem/solution, or off/on comparisons use a muted lavender panel with purple accents next to a purple panel with white accents. The label chip inverts too. Order follows reading direction: before at start.

6. **Arabic-first typography.** Tajawal throughout (400/500/700/800), generous line-height (1.7 body, up to 1.9 for large storytelling text), weight and brand color for emphasis, no letter-spacing. Headings are heavy (800), body is regular, labels are bold. Latin brand words switch to Inter bold via `.mf-latin`.

7. **Round, not sharp.** Radii step 8 (inputs on purple) → 16 (buttons, labels) → 24 (cards) → 40 (feature panels) → arch/pill/circle. No square corners anywhere except the arch's base.

## Workflow

1. **Set the document up for RTL.** `<html lang="ar" dir="rtl">`, `body.mf-page`, tokens.css loaded (includes the Google Fonts import for Tajawal and Inter). Use logical CSS properties (`margin-inline-start`, `inset-inline-end`, `padding-inline`) or Tailwind's `ms-/me-/ps-/pe-/start-/end-` everywhere, so an LTR version only needs `dir="ltr"`.

2. **Lay out the rhythm.** Start from the shell in `references/components.md`: purple top bar → white nav → purple hero with wave → white sections → purple footer. For pages other than the landing page (category, PDP, cart), keep the top bar, nav, and footer, and replace the hero with a slim purple page-title band (no wave) or skip it.

3. **Pick components from the reference.** Feature cards for benefits, arch tiles for products, split section for brand story, inverted panels for transformation, testimonial cards with ring avatars for social proof. Lift CSS from `assets/reference-landing.html`.

4. **Write the copy properly.** Feminine address, correct hamzas and tanween, «» quotes, Arabic-Indic digits with ٬ and ٫ separators in prices, `dir="ltr"` on phones and emails. Follow `references/content-and-copy.md`. If you're working from the original mock, apply the fixes listed there (swapped before/after copy, placeholder course text, spelling).

5. **Check accessibility.** Brand text on the muted panel only at large sizes, stars always labelled, focus rings visible on white and on purple, 44px touch targets, Arabic alt text.

6. **Verify.** If you can render, screenshot at 1440px and 390px and compare with `reference-landing.png`. Run the checklist below.

## Token cheat sheet

```
Purple  50 #F6F3FF · 100 #E0DDEA · 200 #DAD6E3 · 300 #CBC5DB
        400 #968AB6 · 500 #7566A0 (brand) · 600 #5F4E91 (hover) · 700 #4A3C78
Neutral white #FFFFFF · ink #1B1A1A · stone #6B6765 · pebble #B5B2B0
Accent  amber #F88820 (stars only)
Type    Tajawal · display 44/800 · h2 40/800 · h3 34/700 · title 24/700
        lead-xl 32/1.9 · lead 24/1.75 · nav 20/700 · body 18/1.7 · small 16 · label 14/700
Radius  8 input · 16 button · 24 card · 40 panel · arch · pill · circle
Shadow  ∓6px 8px 14px -4px rgba(117,102,160,.32)  (falls away from reading start)
Layout  container 1200 · gutter 32 · section 120 · title→content 64 · topbar 64 · nav 68
```

## Responsive

- ≥ 1280px: as designed.
- 1024-1279px: container fluid with 32px side padding; products and features stay 4-up if tiles ≥ 220px, else 2-up.
- 768-1023px: nav collapses to a drawer; hero stacks (text first); features 2-up; testimonials 2-up.
- < 768px: search moves under the top bar; hero image above centered text, wave 40px; products in a horizontal scroll-snap row; comparison panels stack before → after; testimonials 1-up carousel; footer stacks. Type: display 32, h2 28, h3 26, lead-xl 22, lead 18; section spacing 72px.

## Don'ts

- Don't use pure black text or grey card shadows.
- Don't put the arch shape on non-product content, or render products in plain square cards.
- Don't use purple-400 or white-on-purple-400 for text (3.2:1).
- Don't center long paragraphs outside cards; start-align them in split sections.
- Don't mix Western and Arabic-Indic digits within prices on the same page.
- Don't add letter-spacing, italics, or underlined headings to Arabic text.
- Don't stack two purple full-width sections back to back.
- Don't copy the source mock's placeholder or swapped content.

## Delivery checklist

- [ ] `lang="ar" dir="rtl"`, logical properties only, directional icons mirrored.
- [ ] All colors, radii, and type from tokens; one brand hue plus amber stars.
- [ ] Purple bookends with white middle; sections 120px apart.
- [ ] Products in arch tiles with add pill, name, and correctly formatted price.
- [ ] Card shadows violet and falling away from the reading start.
- [ ] Before/after panels inverted, ordered before → after, copy in the right panel.
- [ ] Arabic copy checked: hamzas, tanween, taa marbuta, «», feminine address, no placeholder text.
- [ ] Stars labelled; focus visible on white and purple; targets ≥ 44px.
- [ ] Layout verified at 1440 and 390px.
