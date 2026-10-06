# Moonflower — token reference

Every value exists as a CSS variable in `assets/tokens.css` and as a Tailwind key in `assets/tailwind-preset.js`. Components should reference the semantic aliases (`--color-brand`, `--text-secondary`), not the raw scale, so a rebrand stays one file.

## Contents
1. Color scale
2. Semantic roles
3. Contrast table
4. Typography
5. Radius
6. Shadows
7. Spacing and layout
8. Motion
9. Imagery and decoration

---

## 1. Color scale

One hue does all the work: a dusty, slightly grey violet. Everything else is white, a warm near-black, or a tint of that violet. There is one non-brand accent (amber), used only for rating stars.

| Token | Hex | Where it appears in the source |
|---|---|---|
| `--mf-purple-50` | #F6F3FF | Arched product tile fill |
| `--mf-purple-100` | #E0DDEA | 1px borders on white cards and tiles |
| `--mf-purple-200` | #DAD6E3 | "Before" comparison panel |
| `--mf-purple-300` | #CBC5DB | Card shadow tint, search outline on purple, arch bottom edge |
| `--mf-purple-400` | #968AB6 | Decorative only (sparkles, dividers on purple) |
| `--mf-purple-500` | #7566A0 | **Brand.** Top bar, hero, footer, icon discs, pills, "after" panel, section title color, avatar rings |
| `--mf-purple-600` | #5F4E91 | Hover and pressed state of brand fills |
| `--mf-purple-700` | #4A3C78 | Brand text on tinted panels; active pagination outline |
| `--mf-white` | #FFFFFF | Page, cards, nav bar, text on brand |
| `--mf-ink` | #1B1A1A | Headings and body (warm near-black, not pure black) |
| `--mf-stone` | #6B6765 | Subtitles, secondary copy |
| `--mf-pebble` | #B5B2B0 | Empty star outline, disabled |
| `--mf-amber` | #F88820 | Filled rating stars |
| `--mf-amber-strong` | #D66A00 | Star outline when the stars must meet 3:1 |

The source presentation sits on a dark indigo backdrop (#21183C) that fades to grey. That's the Dribbble-style mockup background, not part of the product.

## 2. Semantic roles

| Alias | Maps to | Use |
|---|---|---|
| `--color-brand` | purple-500 | Brand blocks (header, hero, footer), primary buttons, icon discs |
| `--color-brand-hover` | purple-600 | Hover on anything filled with brand |
| `--color-page` / `--color-surface` | white | Page background, cards |
| `--color-surface-tint` | purple-50 | Product tiles, avatar fallback, hover on white buttons |
| `--color-surface-muted` | purple-200 | Secondary/"before" panels |
| `--color-border` | purple-100 | Card and tile hairlines |
| `--color-border-on-brand` | purple-300 | Outlines that sit on purple (search) |
| `--color-rating` | amber | Stars |
| `--text-primary` | ink | Default text |
| `--text-secondary` | stone | Subtitles |
| `--text-brand` | purple-500 | Brand-colored headings, Latin brand name |
| `--text-on-brand` | white | Anything on purple-500 |

Page rhythm alternates **brand block → white → white … → brand block**. The purple is structural (header, hero, footer) and appears inside white sections only as small fills (icon discs, pills, rings) or one feature panel. Never place two full-width purple sections back to back.

## 3. Contrast table

Measured with the WCAG formula.

| Foreground | Background | Ratio | Verdict |
|---|---|---|---|
| ink #1B1A1A | white | 17.4:1 | Any size |
| ink | purple-200 | 12.2:1 | Any size |
| white | purple-500 | 5.0:1 | Any size (AA) |
| white | purple-600 | 7.0:1 | Any size (AAA large) |
| purple-500 | white | 5.0:1 | Any size |
| purple-500 | purple-50 | 4.6:1 | Any size, barely; keep ≥ 16px |
| purple-500 | purple-200 | 3.5:1 | Large/bold text only (≥ 24px or ≥ 19px bold) |
| purple-700 | purple-50 | 8.7:1 | Any size |
| stone #6B6765 | white | 5.6:1 | Any size |
| stone | purple-50 | 5.1:1 | Any size |
| purple-300 outline | purple-500 | 3.0:1 | Meets 3:1 for UI boundaries |
| amber #F88820 | white | 2.5:1 | **Fails 3:1** for meaningful graphics; always pair stars with an accessible label, or outline in amber-strong (3.6:1) |
| pebble #B5B2B0 | white | 2.1:1 | Decorative/disabled only |
| white | purple-400 | 3.2:1 | Don't use for text |

## 4. Typography

**Tajawal** for all Arabic text (and Latin fallback). It's a close match to the source's letterforms (the open ك, round ة, compact teeth on س/ش). Weights used: 400, 500, 700, 800. **Inter** (or Helvetica/Arial) only for Latin brand words inside Arabic headings, like "Moon Flower"; the source uses a neo-grotesque bold for these, which contrasts deliberately with the Arabic.

| Token | Size / line-height / weight | Use |
|---|---|---|
| `--type-display` | 44 / 1.5 / 800 | Hero H1 (white on brand) |
| `--type-h2` | 40 / 1.4 / 800 | Centered section titles; "best sellers" row title at 36 |
| `--type-h3` | 34 / 1.5 / 700 | Split-section heading |
| `--type-title` | 24 / 1.4 / 700 | Product names; feature card titles drop to 22 to fit one line |
| `--type-lead-xl` | 32 / 1.9 / 400 | Split-section paragraph (big, airy storytelling copy) |
| `--type-lead` | 24 / 1.75 / 400 | Hero paragraph, comparison panel copy, prices |
| `--type-nav` | 20 / 1.3 / 700 | Nav items, footer links, footer column titles |
| `--type-subtitle` | 20 / 1.6 / 400 | Under section titles, in stone |
| `--type-body` | 18 / 1.7 / 400 | Card descriptions, testimonial quotes |
| `--type-small` | 16 / 1.7 / 400 | Footer paragraph, reviewer name, inputs |
| `--type-label` | 14 / 1 / 700 | Add-to-cart pill, badges |

Arabic rules:
- Body line-height never below 1.6; Arabic diacritics and descenders need the room. The source's airy 1.75-1.9 on lead copy is part of the look.
- No letter-spacing on Arabic (it breaks joining). No uppercase transforms exist, so don't simulate emphasis with spacing; use weight 700/800 or brand color.
- Section H2s carry `--shadow-heading` (a soft 4px drop shadow). Use it only on those centered section titles, never on body, cards, or text on purple.
- Numbers: the source uses Arabic-Indic digits (٠١٢٣…) in prices and percentages. Keep that consistent per page; see `content-and-copy.md` for formatting.

## 5. Radius

| Token | px | Use |
|---|---|---|
| `--radius-sm` | 8 | Footer input and send button |
| `--radius-md` | 16 | Primary buttons, comparison labels |
| `--radius-lg` | 24 | Feature cards, testimonial cards, page frame corners |
| `--radius-xl` | 40 | Top corners of comparison panels (bottom corners use lg) |
| `--radius-pill` | 999 | Search field, add-to-cart pill, pagination dots |
| Arch | 50% / 45% top, 0 bottom | Product tiles (`.mf-arch`) |
| Circle | 50% | Icon discs, avatars, social buttons |

The arch is the brand's signature shape: it echoes a moon and a flower petal, and it's what makes product rows recognizably "Moonflower". Use it for product imagery containers and nowhere else so it keeps its meaning.

Note: the source uses ~12px on testimonial cards and 24px on feature cards. The system unifies both to 24px.

## 6. Shadows

| Token | Value | Use |
|---|---|---|
| `--shadow-card` | ±6px 8px 14px -4px rgba(117,102,160,.32) | White cards. Tinted violet, never grey |
| `--shadow-card-hover` | ±10px 14px 24px -6px rgba(117,102,160,.38) | Card hover (optional) |
| `--shadow-heading` | 0 4px 4px rgba(0,0,0,.18) | Centered section H2 only |
| `--shadow-avatar-ring` | 0 0 0 5px purple-500 | Testimonial avatars |

Light comes from the top **start** corner. In RTL that's top-right, so shadows fall down and to the left; `--shadow-dir` flips automatically under `[dir="ltr"]`. The source's testimonial shadows are greenish-grey (#D0DBD1); that's an inconsistency, so use the violet shadow everywhere.

## 7. Spacing and layout

8px base: 4, 8, 12, 16, 24, 32, 48, 64, 96, 120.

| Token | Value | Use |
|---|---|---|
| `--container` | 1200px | Content width at 1440 |
| `--gutter` | 32px | Gap between cards in a row |
| `--section-y` | 120px | Space between sections |
| `--section-title-gap` | 64px | Title block → content |
| `--topbar-h` | 64px | Purple utility bar |
| `--navbar-h` | 68px | White category nav |

Grids used: 4-up (features, products), 3-up (testimonials, with extra 110px gaps so the overlapping avatars breathe), 2-up (split story section, comparison panels), 4-column footer (about 1.3fr, links 1fr, contact 1fr, message 1.2fr).

Content in 2-up splits: text sits on the **start** side (right in RTL), imagery on the end side. Headings and paragraphs are start-aligned inside splits and center-aligned inside cards and section heads.

## 8. Motion

Minimal and tactile: `--dur-fast` 150ms for color/background changes, `--dur-base` 250ms for card hover lift (shadow grows, optional `translateY(-4px)`). Carousel slides with 400ms ease. No parallax, no looping animation. Respect reduced motion.

## 9. Imagery and decoration

- **Product photography**: packshots cut out on transparent backgrounds with soft contact shadows, placed inside arch tiles or composed with natural props (white flowers, green leaves, wood, pebbles). Warm neutrals and green foliage are the only non-violet colors that appear in quantity, and they come from the photos, not the UI.
- **People**: waist-up cutouts that bleed off the bottom of their panel, facing into the panel toward the copy.
- **Sparkle** (four-point star, ✦): small (24-34px), white on purple panels or white/lavender near a person's shoulder. Max one per panel.
- **Wave**: the hero's bottom edge is an asymmetric wave (`.mf-wave-bottom`), rising toward the end side. It's the only curved section edge on the page.
- **Icons**: filled glyphs (not outline) inside purple discs for features; small outline icons (search, cart) in the header.
- **Emoji**: the source drops a 🌸 after the brand name in one heading and a rain-cloud emoji in the "before" label. Keep emoji to one or two small flourishes per page, never in body copy or buttons.
