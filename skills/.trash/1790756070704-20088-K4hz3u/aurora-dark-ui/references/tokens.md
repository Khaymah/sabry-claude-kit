# Aurora Dark UI — token reference

Every value here also exists as a CSS variable in `assets/tokens.css` and as a Tailwind key in `assets/tailwind-preset.js`. Always reference the variable, never paste the raw hex into components; the hex is here so you can reason about contrast and layering.

## Contents
1. Neutrals and surfaces
2. Text
3. Semantic accents
4. Gradients
5. Shadows and glows
6. Radius
7. Spacing and layout
8. Typography
9. Motion
10. Contrast notes

---

## 1. Neutrals and surfaces

The palette is graphite with a faint blue tint (the blue channel is always a few points higher than red). Depth comes from lightness steps, not from borders or drop shadows.

| Token | Hex | Role |
|---|---|---|
| `--color-frame` | #05070A | Hairline around the app shell |
| `--color-input` | #05060F | Deepest well: chat composer |
| `--color-canvas` | #0C1015 | Main content background, assistant panel |
| `--color-sidebar` | #13171C | Left rail, one step lighter than canvas |
| `--color-surface-inset` | #161A1E | Rows placed inside a card |
| `--color-bubble` | #191D21 | Chat bubbles, small pills on canvas |
| `--color-surface` | #1A1E23 | Card body (gradient end) |
| `--color-surface-raised` | #22262B | Hover and selected rows |
| `--color-surface-top` | #2A2E31 | Card top (gradient start) |
| `--color-track` | #34383D | Progress tracks, disabled fills |

Layering order from deepest to highest: input → canvas → sidebar → inset → bubble/surface → raised → surface-top. A child element is either one step lighter than its parent (raised content) or one step darker (inset well). Never place two elements with the same fill directly adjacent without a gap.

Borders are translucent white so they adapt to any surface:

| Token | Value | Use |
|---|---|---|
| `--border-subtle` | rgba(255,255,255,.06) | Panel outlines, bubbles, chips |
| `--border-default` | rgba(255,255,255,.10) | Icon wells, pills that need definition |
| `--border-strong` | rgba(255,255,255,.16) | Focused non-edge-light inputs |

## 2. Text

| Token | Hex | Use |
|---|---|---|
| `--text-primary` | #F3F4F6 | Headings, values, message text |
| `--text-secondary` | #B4B8BF | Chip labels, list items, icons at rest |
| `--text-tertiary` | #8A8F97 | Nav at rest, meta, "View all", timestamps, placeholders |
| `--text-muted` | #5E636B | Disabled only; never for information the user needs |
| `--text-on-light` | #16161C | Text on any aurora surface |

On the aurora card, body text uses a grey around #5B5F66 rather than `--text-on-light` so the heading keeps its weight (see contrast notes before copying this).

## 3. Semantic accents

An accent is a category, not decoration. Once a hue means "in progress", it means that on the stat card icon, the delta arrow, the calendar dot, the bullet, and the progress bar.

| Token | Hex | Default meaning | Where it appears |
|---|---|---|---|
| `--accent-violet` | #6A5AE0 | Tasks / to-do | Stat icon, delta, card corner flare |
| `--accent-violet-soft` | #B379E1 | Overdue / attention (list context) | Bullet dots |
| `--accent-amber` | #F49514 | In progress, campaigns | Stat icon, progress bar |
| `--accent-amber-soft` | #E8C17E | Same category, small dots | Calendar dot, bullets |
| `--accent-green` | #6BBF72 | Completed | Stat icon, delta |
| `--accent-success` | #14EB78 | Completed event (badge fill) | Activity feed check badge |
| `--accent-blue` | #68B3EC | Primary data series, focus ring | First progress bar |
| `--accent-blue-strong` | #2F6FDB | Time / focus metrics | Stat icon, delta, flare |
| `--accent-blue-soft` | #77A3E2 | Blue in small sizes | Dots, quick-action icons |
| `--accent-coral` | #ED7572 | Secondary series, due items | Second progress bar, bullets |
| `--accent-danger` | #D33A3A | Notification, "today" marker | Bell badge, date dot |

Use the full-strength accent for strokes ≥ 1.5px and fills ≥ 4px tall. Use the `-soft` variant for dots under 6px, where saturated colors vibrate on the dark background.

## 4. Gradients

| Token | Use | Frequency |
|---|---|---|
| `--gradient-aurora` | Active nav pill; could also be a primary CTA pill | 1 per region |
| `--gradient-aurora-card` | The single light "AI suggestion" card | Max 1 per screen |
| `--gradient-aurora-orb` | Circular primary action (send) | 1 per composer |
| `--gradient-edge` | 1px border on search, bell, "Add Event", assistant switcher | Interactive outlines only |
| `--gradient-card` | Every dark card body | All cards |
| `--gradient-row` | Rows inside a card (activity items) | Nested rows |

Aurora stops, left to right: periwinkle blue #7BA9EC → pale lilac #A9C0EA → pearl #ECE1E9 → blush #FDD0D8 → pink #FE9FC1 → rose #F5A9CA. The center is almost white; that bright middle is what makes the pill read as lit rather than colored. Don't swap in saturated stops.

Edge light runs warm (peach #F2AA7D) on the leading edge, fades to near-transparent white across the top, and ends cool (blue #6E9BE1) on the trailing edge. In RTL, flip the gradient direction so warm stays on the leading edge.

## 5. Shadows and glows

There are no grey drop shadows under cards. Light is expressed three ways instead:

- **Top-lit cards**: `--gradient-card` plus `--shadow-card` (1px inner highlight).
- **Colored glow on data**: progress fills get `box-shadow: 0 0 10px <accent @ 55%>`. Only data glows.
- **Composer halo**: `--glow-composer`, blue bleeding from the left, pink from the right and top. It marks the one place the user talks to the AI.
- **Persona halo**: `--glow-avatar`, a soft blue radial behind the assistant portrait.

`--shadow-frame` is only for presenting the whole app on a light backdrop (marketing shots).

## 6. Radius

| Token | px | Use |
|---|---|---|
| `--radius-xs` | 6 | Tiny tags |
| `--radius-sm` | 10 | Icon tiles inside rows |
| `--radius-md` | 12 | Rows, quick-action chips |
| `--radius-lg` | 16 | Cards, assistant panel, bubbles |
| `--radius-xl` | 22 | Composer, aurora card |
| `--radius-2xl` | 28 | App frame |
| `--radius-pill` | 999 | Nav items, search, buttons, avatars, tool dock |

Rule of thumb: containers use rounded rectangles that step down as they nest (28 → 16 → 12 → 10); anything you click that isn't a card is a pill or circle.

## 7. Spacing and layout

4px base: 4, 8, 12, 16, 20, 24, 32, 40.

| Token | Value | Use |
|---|---|---|
| `--layout-sidebar` | 220px | Left rail width |
| `--layout-aside` | 330px | Right widget column |
| `--layout-topbar` | 76px | Header height |
| `--layout-gap` | 12px | Gap between sibling cards |

Card padding: 16px (widgets) to 20px (stat cards). Gap between card header and body: 12px. Gap between list rows: 6px. Sidebar item height 44px, gap 6px.

Desktop grid at 1440: `220px | 1fr | 330px`, main column holds a 4-up stat row above the assistant panel. Below 1200px, the aside drops under the main column as a 2-column widget grid. Below 768px, the sidebar becomes a bottom sheet or drawer, stats go 2-up, and the composer pins to the bottom.

## 8. Typography

One family: **Poppins** (300/400/500/600). For Arabic, **IBM Plex Sans Arabic** at the same weights; its x-height sits comfortably next to Poppins in mixed strings.

| Token | px | Weight | Use |
|---|---|---|---|
| `--text-stat` | 34 | 400 | KPI values ("6", "2h 45m") |
| `--text-2xl` | 24 | 500 | Page titles on sub-pages |
| `--text-xl` | 18 | 500 | Greeting, persona name |
| `--text-lg` | 16 | 400 | Card titles ("Calendar", "Task Today") |
| `--text-md` | 14 | 400 | Chat messages, deltas, body |
| `--text-sm` | 13 | 400 | Nav items, chips, search placeholder |
| `--text-xs` | 12 | 400 | Bullets, percentages, timestamps under rows |
| `--text-2xs` | 11 | 400 | Row text, meta lines, "View all" |

Weights stay light. Card titles are regular (400), not bold; hierarchy comes from size and color. Medium (500) marks the active nav item, the greeting, the persona name, and button labels. Semibold (600) is reserved for the wordmark. Nothing uses 700.

Sentence case everywhere except the wordmark. Numbers use the default proportional figures; for values that tick (timers), add `font-variant-numeric: tabular-nums`.

## 9. Motion

| Token | Value |
|---|---|
| `--ease-out` | cubic-bezier(0.22, 1, 0.36, 1) |
| `--duration-fast` | 140ms (hover color/background) |
| `--duration-base` | 200ms (menus, chip press) |
| `--duration-slow` | 320ms (panel expand, progress fill on load) |

Signature motion: the "Thinking…" label uses a slow text shimmer (2.2s linear loop). Progress fills animate width once on load. Nothing else loops. Respect `prefers-reduced-motion`.

## 10. Contrast notes

- `--text-primary` on `--color-surface`: ~15:1.
- `--text-secondary` on `--color-surface`: ~8.5:1.
- `--text-tertiary` on `--color-surface`: ~5:1, passes AA for body text.
- `--text-muted` on `--color-surface`: ~2.8:1, decorative/disabled only.
- `--text-on-light` on the aurora pill: at least 7.4:1 (lowest at the blue stop, ~14:1 at the pearl center).
- Amber #F49514 (7.3:1) and coral #ED7572 (5.9:1) pass AA as text on surface, but prefer them as fills and icons with neutral labels beside them.
- The grey body text on the aurora card drops to ~2.5:1 where it crosses the saturated blue corner (6.4:1 on the white middle). The original design lets it overlap; when building for real, darken it to #3F434A or start the text past the first 25% of the gradient.
