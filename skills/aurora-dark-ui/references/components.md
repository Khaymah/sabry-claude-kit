# Aurora Dark UI — component reference

Anatomy and specs for every component in the reference dashboard, plus rules for extending the set. Working CSS for all of them lives in `assets/reference-dashboard.html`; copy from there rather than rewriting from scratch.

## Contents
- App shell
- Sidebar and nav item
- Top bar: greeting, search, bell, profile
- Stat card (KPI)
- Widget card (header pattern)
- Calendar list
- Progress list
- Activity feed row
- AI suggestion card
- Assistant panel: persona, bubbles, AI message, thinking state
- Quick-action chip
- Composer
- Tool dock
- Buttons (4 kinds)
- Icon well and icon tile
- Avatars
- States (hover, focus, active, disabled, empty, loading)
- Extending the system

---

## App shell

```
┌────────────┬──────────────────────────────────────────────────────────┐
│            │ Greeting        [ search .................. ]  (🔔) (●) Name ▾ │
│  Sidebar   ├──────────────────────────────────────┬───────────────────┤
│  220px     │ [Stat] [Stat] [Stat] [Stat]          │ Calendar card     │
│            ├──────────────────────────────────────┤ Progress card     │
│  nav       │                                      │ Activity card     │
│            │   Assistant panel (chat)             │                   │
│  ...       │                                      │ AI suggestion     │
│  settings  │   chips · composer                   │ (aurora card)     │
│  switcher  │                                      │                   │
└────────────┴──────────────────────────────────────┴───────────────────┘
```

- Frame radius 28px, background `--color-canvas`, `overflow: hidden`.
- Sidebar is a full-height column in `--color-sidebar`. The top bar and content sit on canvas with no separating line; the sidebar's lighter fill is the only divider.
- Content grid: `1fr 330px`, column gap 24px, row gap 12px.

## Sidebar and nav item

- Padding 22px 14px 18px. Wordmark at top (16px, 600), 34px gap before nav.
- Nav item: height 44px, padding 0 16px, gap 12px icon→label, radius pill, 13px, `--text-tertiary`, icon 18px stroke 1.6.
- Hover: text `--text-primary`, background `rgba(255,255,255,.03)`.
- Active (`aria-current="page"`): `--gradient-aurora` fill, `--text-on-light`, weight 500. Exactly one active item.
- Expandable item: chevron-down 16px pushed to the end with `margin-inline-start: auto`.
- Bottom group (Settings, Help) pinned with `margin-top: auto`.
- Assistant switcher: pill, `edge-light` with `--edge-fill: var(--color-sidebar)`, avatar 32px, name 13px/500, role 10px tertiary, chevron at end.

## Top bar

- Height 76px, items vertically centered, gap 36px.
- Greeting: 18px/500, primary. Personalize with the user's name.
- Search: pill, height 46px, max-width 520px, `edge-light` with `--edge-fill: #0E1218`, search icon 18px tertiary, placeholder 13px tertiary. Placeholder names what can be searched ("Search task, project, notes").
- Bell: 48px circle, `edge-light`, unread dot 6px `--accent-danger` at top-right of the glyph.
- Profile: avatar 40px, name 14px/500, role 12px tertiary, chevron 18px secondary, 14px gap before chevron.

## Stat card (KPI)

```
╭◜────────────────────╮   ← 1.5px corner flare in the category accent
│ [icon] Title        │   16px regular, icon 22px in accent color
│                     │
│ 6                   │   34px regular, line-height 1
│                     │
│ ▲ 2 from yesterday  │   14px tertiary; triangle 10×8 in accent
╰─────────────────────╯
```

- `.surface-card[data-accent="violet|amber|green|blue|coral"]`.
- Padding 18px 20px 20px, internal gap 14px, radius 16px.
- Four cards in a row with 12px gaps. Each card gets a different accent, and that accent must match the category's color elsewhere on the screen.
- Delta: triangle up for increase, down for decrease. Color stays the category accent, not red/green; direction carries meaning, color carries category. If a metric genuinely needs good/bad signaling, add a text label ("↓ 2 behind plan"), don't recolor.

## Widget card (header pattern)

Every aside card shares this header:

```
(◐) Card title                     View all ›
```

- Icon well 34px circle (`.icon-well`), 10px gap, title 16px regular.
- Trailing link 11px tertiary, optional chevron-right 12px. Pushed to the end.
- Header → body gap 12px. Card padding 16px 16px 18px.

## Calendar list

- Meta line: "Today • May 20, 2025", 11px tertiary; the separator is a 4px `--accent-danger` dot.
- Row: grid `12px | 1fr | 70px | 34px | 20px`, height 36–40px, 11px. Title in primary, time and duration in secondary.
- Leading dot 5px in the event's category color. The current/next event gets a white dot with a short violet vertical line above it (a mini timeline).
- Trailing 16px meeting-provider glyph.
- Footer action: "Add Event" ghost button, full width, pill, height 34px, `edge-light`.

## Progress list

- Label 11px tertiary, 8px above the bar.
- Row grid `1fr | 36px`: track 4px pill `--color-track`; value 11px primary, end-aligned.
- Fill uses `background: currentColor` with `color` set to the accent, plus `.glow`.
- Width must equal the number. (The source mock shows three identical widths for 68/45/30; don't repeat that.)
- Order series blue → coral → amber → violet → green.

## Activity feed row

- Row: `--gradient-row`, radius 12px, padding 6px, gap 12px, rows 6px apart.
- Leading tile 40px, radius 10px, fill #20242A. Contents: a 22px success badge (`--accent-success` circle with dark check), a person avatar 28px, or a 18px line icon in secondary.
- Text: event line 11px primary, timestamp 12px tertiary below it.
- Phrase events as past-tense sentences naming actor and object ("Lina updated the project status").

## AI suggestion card

- `.aurora-card`, radius 22px, padding 16px 16px 18px, internal gap 8px.
- Heading 14px/500 on-light with an 18px bulb icon. Body 12px grey. Action: solid dark pill.
- One per screen. It represents a proactive recommendation from the assistant, so the copy states the benefit and the button names the action ("Automate now").

## Assistant panel

Container: canvas fill, 1px `--border-subtle`, radius 16px, padding 18px 48px 20px. Rows: upsell chip → thread → quick actions → composer.

- **Upsell chip** (optional, dismissible): pill 34px, `--color-bubble`, `--border-default`, sparkle icon + 12px/500 label + × in tertiary. Centered at top.
- **Expand icon**: 18px tertiary at top-right corner.
- **Persona**: portrait 96–110px circle with `--glow-avatar`, name 18px/500, role 12px tertiary, centered, positioned in the upper-right of the panel. The thread must leave room so bubbles never run under it.
- **User bubble**: aligned to the end, max-width ~270px, padding 12px 16px, `--color-bubble`, `--border-subtle`, radius 16px, 14px/1.45.
- **AI message**: no bubble. 28px avatar, 18px gap, text sits directly on canvas. Heading 14px regular, then a list with 6px colored dots, items 12px secondary, 6px apart. Dot colors follow the semantic accents of what each item refers to.
- **Thinking state**: "Thinking…" 14px with the shimmer gradient clip, next to the AI avatar.

## Quick-action chip

- Height 34px, padding 0 12px, radius 12px (rounded rect, not pill, to distinguish from nav), `--color-surface`, `--border-subtle`, 13px secondary, icon 16px in `--accent-blue-soft`, `white-space: nowrap`.
- Hover: `--color-surface-raised`, text primary.
- Label is a verb phrase in sentence case ("Plan my day").
- Row centered, 16px gap, 3–4 chips.

## Composer

- Width ~580px centered, height 92px, radius 22px, `--color-input`, 1px rgba(255,255,255,.05), `--glow-composer`.
- Placeholder 12px tertiary on top line ("Type a message or ask anything…").
- Bottom row: attach (+) 20px at start; at end a 32px mic circle (#1D2026, secondary icon) and a 32px `.aurora-orb` send button with a filled dark paper-plane.
- The composer is the only element with a colored halo. Don't add glows to other inputs.

## Tool dock

- Vertical pill floating at the panel's end edge, padding 14px 9px, gap 14px, 3 icons 18px secondary.
- Border is a vertical edge light: white at top fading to peach at the bottom.

## Buttons

| Kind | Look | Use |
|---|---|---|
| Aurora pill | `--gradient-aurora`, on-light text 500 | The single most important action in a region |
| Aurora orb | 32–40px circle, `--gradient-aurora-orb`, filled dark icon | Send / submit to AI |
| Edge-light ghost | Pill, `.edge-light` with the parent's fill, primary text 500 | Secondary actions on dark cards ("Add Event") |
| Solid dark | Pill, #141416, white 14px | Primary action on a light (aurora) surface |

Heights: 34px (in cards), 38–44px (standalone). Horizontal padding 16–20px. Icon buttons are circles at 32/40/48px.

## Icon well and icon tile

- Icon well: 34px circle, radial fill #2C3036→#1B1F24, `--border-default`, icon 15px secondary. For card headers.
- Icon tile: 40px rounded square (10px), #20242A. For list rows.
- Icons: 1.5–1.6px stroke, round caps and joins, no fill (except send and pie). Lucide matches this style closely.

## Avatars

- Circle, sizes 28 (inline), 32 (switcher), 40 (profile), 96–110 (persona).
- The assistant persona always carries a soft blue halo. People never do.

## States

- **Hover**: lighten one surface step or raise text from tertiary/secondary to primary. 140ms.
- **Focus**: 2px `--accent-blue` outline, 2px offset, on every interactive element.
- **Active/pressed**: `transform: scale(.98)` on chips and buttons, 140ms.
- **Selected**: nav uses aurora; lists use `--color-surface-raised`.
- **Disabled**: text `--text-muted`, remove edge light (plain `--border-subtle`), no hover.
- **Empty**: inside the card body, 12px tertiary sentence that says what to do, plus an edge-light ghost button ("No events today. Add event").
- **Loading**: skeleton blocks in `--color-surface-raised` with a slow opacity pulse; AI responses use the "Thinking…" shimmer instead.

## Extending the system

When a screen needs something not listed here (tables, modals, tabs, toasts, forms), derive it from these rules rather than inventing new styling:

1. Pick the surface by depth: overlays and modals use `--gradient-card` at radius 16–22px on a backdrop of `rgba(5,7,10,.6)` with blur 8px.
2. Pick the shape by role: containers are rounded rectangles; controls are pills or circles.
3. Pick color by meaning: neutral unless it encodes a category, then use that category's accent.
4. Pick emphasis by scarcity: if aurora is already on screen in the same region, the new element uses edge light or solid dark instead.
5. **Tables**: header row 11px tertiary on `--color-surface-inset`; rows 12px primary, 44px tall, separated by `--border-subtle`; hover `--color-surface-raised`; status as a 6px accent dot + label.
6. **Tabs / segmented control**: container pill in `--color-bubble`; selected segment in `--color-surface-top` with primary text (reserve aurora for nav).
7. **Text inputs**: height 42px, radius 12px, `--color-surface-inset`, `--border-subtle`; on focus switch to `.edge-light`.
8. **Toasts**: `--gradient-card`, radius 14px, leading 6px accent dot, 13px primary, action as tertiary text link.
9. **Modals**: max-width 480px, padding 24px, title 18px/500, actions right-aligned: edge-light ghost + aurora pill.
