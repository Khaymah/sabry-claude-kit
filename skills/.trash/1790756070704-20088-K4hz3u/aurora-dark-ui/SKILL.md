---
name: aurora-dark-ui
description: Design system for dark, AI-first dashboards in the "Aurora Dark" style (extracted from the Daily AI dashboard reference) - blue-tinted graphite surfaces lit from above, one blue-to-pink "aurora" gradient reserved for active and AI moments, 1px warm-to-cool edge-light borders, glowing data bars, and Poppins at light weights. Use this skill whenever the user asks to build, style, restyle, or extend any UI in this design system or refers to it by name (Aurora Dark, Daily AI style, "the dark AI dashboard design", "our design system"), including dashboards, admin panels, AI assistant/chat screens, SaaS app shells, widgets, landing sections, or individual components (cards, nav, composer, buttons, tables, modals). Also use it when generating React, Vue, HTML/CSS, or Tailwind code that must match this look, when writing design tokens or a theme file for it, or when reviewing a screen for consistency with it - even if the user just says "make it look like the dashboard" or "use our dark theme".
---

# Aurora Dark UI

A dark productivity dashboard language built around an AI assistant. The mood is calm, premium, and nocturnal: near-black surfaces with a blue cast, soft light falling on cards from above, and color appearing only where it means something. One iridescent gradient (periwinkle → pearl → pink) is the brand signature, and it is used sparingly so that it always points at the most important thing.

## Files in this skill

| File | Read it when |
|---|---|
| `assets/tokens.css` | Always. Copy it into the project (or inline it) before writing components. It holds every variable plus the signature utilities `.edge-light`, `.surface-card`, `.aurora`, `.aurora-card`, `.aurora-orb`, `.glow`, `.icon-well`. |
| `assets/tailwind-preset.js` | The project uses Tailwind. Add it to `presets` and still import `tokens.css` for the utilities that Tailwind can't express (masked corner flare, gradient borders). |
| `references/tokens.md` | You need an exact value, a role for a color, the type scale, radius ladder, or contrast numbers. |
| `references/components.md` | You're building a specific component, or need something not in the reference (tables, tabs, modals, inputs, toasts) and want the derivation rules. |
| `assets/reference-dashboard.html` | You want working CSS for a component, or a visual target. It rebuilds the full dashboard using only the tokens. `reference-dashboard.png` is its render. |

## The seven rules that make it look right

These matter more than any individual hex value. A screen that follows them with slightly different numbers still looks like the system; a screen with the exact numbers that breaks them won't.

1. **Depth by lightness, not by shadows.** Surfaces step from `--color-input` (deepest) through canvas, sidebar, surface, raised, up to `--color-surface-top`. Cards use `--gradient-card` (lighter at the top edge) and a 1px inner highlight. No grey drop shadows under cards.

2. **Aurora is scarce.** `--gradient-aurora` and its card/orb variants appear at most three times per screen, each marking a different "most important" thing: the active nav item, the send button, and one proactive AI suggestion card. If you're tempted to put aurora on a fourth element, use edge light or a solid dark pill instead. Text on aurora is always dark (`--text-on-light`).

3. **Accent color = category.** Violet means tasks, amber means in progress, green means completed, blue means time/primary data, coral means secondary data or due. Once assigned, a category keeps its color on icons, dots, deltas, bars, and card corner flares across the whole product. Deltas show direction with the triangle, not by turning red or green.

4. **Interactive outlines are light, not lines.** Search, notification bell, ghost buttons, and the assistant switcher use `.edge-light`: a 1px gradient border, warm peach on the leading edge fading to cool blue on the trailing edge. Static containers use plain `--border-subtle` or no border at all.

5. **Only data and the AI glow.** Progress fills glow in their own color; the composer has a blue/pink halo; the assistant portrait has a soft blue halo. Nothing else emits light.

6. **Light type, hierarchy by size and color.** Poppins, mostly 400. Card titles 16px regular, KPI numbers 34px regular, body 14px, rows 11-12px. Medium (500) marks active nav, greeting, persona name, and buttons. Never bold. Secondary information steps down through `--text-secondary` → `--text-tertiary` rather than shrinking further.

7. **Shape follows role.** Containers are rounded rectangles that tighten as they nest (frame 28 → cards 16 → rows 12 → tiles 10). Things you click that aren't cards are pills or circles. Quick-action chips are the one exception (12px rounded rect) so they read differently from nav.

## Workflow

1. **Load tokens.** Put `tokens.css` in the project's global styles (or the Tailwind preset plus tokens.css). Set `body { font-family: var(--font-sans); background: var(--color-canvas); color: var(--text-primary); }`. For single-file HTML deliverables, inline the file's contents in a `<style>` tag.

2. **Map the screen to the shell.** Most screens fit sidebar (220px) + main + optional aside (330px) under a 76px top bar. Decide what lives in the main column versus widgets in the aside before styling anything.

3. **Assign categories.** List the kinds of things the screen shows (tasks, projects, events, metrics) and bind each to an accent from rule 3. Write this down in a comment at the top of the component file so every child uses the same mapping.

4. **Place the aurora moments.** Decide which one to three elements get aurora. Everything else is graphite, edge light, or accent.

5. **Build from components.** Use the specs in `references/components.md` and lift CSS from `assets/reference-dashboard.html`. Reference variables, never raw hex, so a theme change stays one-file.

6. **Write real copy.** Sentence case, verb-first actions ("Add event", "Plan my day"), past-tense activity lines naming the actor, placeholders that say what can be searched. Fix the reference's typos rather than copying them ("Good morning", "2 from yesterday", "Here's your daily brief").

7. **Check before delivering.** Run the checklist below. If you can render and screenshot, compare against `reference-dashboard.png` at the same width.

## Quick token cheat sheet

```
Surfaces   input #05060F · canvas #0C1015 · sidebar #13171C · surface #1A1E23
           raised #22262B · surface-top #2A2E31 · track #34383D
Borders    subtle rgba(255,255,255,.06) · default .10 · strong .16
Text       primary #F3F4F6 · secondary #B4B8BF · tertiary #8A8F97 · on-light #16161C
Accents    violet #6A5AE0 · amber #F49514 · green #6BBF72 · success #14EB78
           blue #68B3EC · blue-strong #2F6FDB · coral #ED7572 · danger #D33A3A
Aurora     #7BA9EC → #A9C0EA → #ECE1E9 → #FDD0D8 → #FE9FC1 → #F5A9CA (90deg)
Radius     10 tile · 12 row/chip · 16 card · 22 composer · 28 frame · pill
Type       Poppins 300/400/500/600 · 11 · 12 · 13 · 14 · 16 · 18 · 24 · 34
Spacing    4px base · card gap 12 · card padding 16–20 · nav item 44 tall
Motion     140/200/320ms · cubic-bezier(.22,1,.36,1)
```

## Arabic and RTL

The system works in RTL with a few adjustments:

- Set `dir="rtl"` and use logical properties throughout (`margin-inline-start`, `padding-inline`, `inset-inline-end`). The reference already does.
- Use `--font-arabic` (IBM Plex Sans Arabic) for Arabic text; keep Poppins for Latin and numerals in mixed strings. Arabic needs about 1.1× the Latin size and `line-height` 1.6 for body text to feel equal.
- Mirror `--gradient-edge` and `--gradient-aurora` (270deg instead of 90deg) so the warm/blue ends stay on the leading edge, and move the stat card flare to the top-right corner (`at 100% 0`).
- Mirror directional icons (chevrons, send arrow, expand) but not the check, clock, or bell.

## Responsive behavior

- ≥1280px: full shell as in the reference.
- 1024-1279px: aside moves below the main column as a 2-up widget grid; stats stay 4-up.
- 768-1023px: sidebar collapses to a 72px icon rail (active item becomes a 44px aurora circle); stats go 2-up.
- <768px: sidebar becomes a drawer, top bar keeps greeting and bell only (search behind an icon), stats 2-up, composer pins to the bottom with the halo reduced to half strength.

## Don'ts

- Don't use pure black #000 or neutral grey #111/#1E1E1E; the blue tint is part of the identity.
- Don't add a second brand gradient, rainbow borders, or glassmorphism blur on cards.
- Don't put aurora behind light text, and don't use saturated accents for large background fills.
- Don't color deltas red/green; don't use more than five accent categories on one screen.
- Don't bold card titles or use all-caps labels.
- Don't add hover lift/translate animations to cards; hover changes fill or text color only.
- Don't let progress bar widths disagree with their numbers.

## Delivery checklist

- [ ] All colors, radii, and font sizes come from variables or preset keys.
- [ ] Aurora appears on three or fewer elements, each with dark text.
- [ ] Each category keeps one accent everywhere it appears.
- [ ] Interactive outlines use edge light; static containers don't.
- [ ] No grey card shadows; cards are top-lit via `--gradient-card`.
- [ ] Type is Poppins/Plex Arabic, weights ≤ 600, sentence case.
- [ ] Focus ring visible on every control; reduced motion respected.
- [ ] Tertiary text is the lowest tier used for readable information (muted is disabled only).
- [ ] Layout holds at 1440, 1024, and 390px widths; RTL mirrors correctly if Arabic is in scope.
