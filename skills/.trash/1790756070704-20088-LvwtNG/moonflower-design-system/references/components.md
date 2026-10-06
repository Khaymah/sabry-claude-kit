# Moonflower — component reference

Specs for every component on the source landing page, written for RTL (Arabic) as the default. "Start" means right in RTL, left in LTR. Working CSS for all of these is in `assets/reference-landing.html`.

## Contents
- Page shell and section rhythm
- Top bar
- Category nav bar
- Hero (brand block with wave)
- Section head
- Feature card
- Split story section
- Product arch tile
- Comparison panels (before / after)
- Testimonial card
- Carousel pagination
- Footer
- Buttons
- Form fields
- States
- Extending the system (PDP, cart, checkout, forms, badges)

---

## Page shell and section rhythm

```
┌──────────────────────────────────────────────────────────────┐
│ [cart] | تسجيل الدخول     ( 🔍 ابحث عن منتجك )        moonflower │ ← purple top bar 64
├──────────────────────────────────────────────────────────────┤
│ مضاد وقطن   مقشرات   بوكسات العناية   عروض   منتجاتنا   الرئيسية │ ← white nav 68
├──────────────────────────────────────────────────────────────┤
│  [product composition]                    H1 display        │
│                                           lead paragraph    │ ← purple hero
│                                           [ white button ]  │
│ ∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿ │
│                     ما الذي يميزنا؟                          │
│        [card]    [card]    [card]    [card]                  │ ← white sections,
│  [photo]                                  H3 + lead-xl      │   120px apart
│  المزيد                               منتجاتنا الأكثر مبيعًا │
│        (arch)    (arch)    (arch)    (arch)                  │
│        [ after panel ]        [ before panel ]              │
│        (card)          (card)          (card)                │
│                          ○ ○ ●                               │
├──────────────────────────────────────────────────────────────┤
│  message | contact | links | logo + about + socials          │ ← purple footer
└──────────────────────────────────────────────────────────────┘
```

- `<html lang="ar" dir="rtl">`. All layout with logical properties.
- Content container 1200px centered. Brand blocks (top bar, hero, footer) span full width.
- When the page is shown framed (mockups), the frame has 24px radius on all corners.

## Top bar

- Height 64px, `--color-brand`, white content.
- Start: logo (Latin wordmark "moonflower" with "Cosmetics" script under it; keep it as an image/SVG, don't re-type it).
- Center: search pill, max-width ~640px, height 42px, 1.5px `--color-border-on-brand` outline, transparent fill, search icon 20px at start, placeholder 16px white 90%.
- End: "تسجيل الدخول" (18px/700), 1.5px × 28px vertical divider, cart icon 30px. A cart count badge, if needed: 18px white circle with purple 12px/700 number, overlapping the cart's top-start corner.

## Category nav bar

- Height 68px, white, bottom hairline `--color-border`.
- 5-7 items distributed with `justify-content: space-between`, 20px/700 ink.
- Hover and current page: brand color plus a 2px underline in brand (the source shows no active state; this is the system's addition).
- Below 1024px: collapses into a drawer triggered from a menu icon in the top bar.

## Hero (brand block with wave)

- `--color-brand` fill, white text, padding 72px top and ~150px bottom (the wave eats 80px).
- Grid: text column 1fr at start, image column 1.25fr at end, vertically centered, 64px gap.
- H1 `--type-display`, max-width ~480px, 2 lines. Paragraph `--type-lead`, max-width ~520px, 24px below the H1.
- CTA: `.btn-on-brand` (white, purple 24px/700 text, 60px tall, min-width 280px, radius 16px), 48px below the paragraph.
- Bottom edge: `.mf-wave-bottom` on the section (mask), or place `hero-wave` SVG in white overlapping the bottom. Mirror it (`transform: scaleX(-1)`) in LTR.
- Imagery: product composition with flowers/leaves, ~420px tall, can overflow the column slightly toward the end edge.

## Section head

- Centered. Title `.mf-section-title` (40px/800 with `--shadow-heading`). Color ink by default, or brand for the first "why us" section.
- Optional subtitle `--type-subtitle` in `--text-secondary`, 24px below, one line.
- Latin brand word inside a title: wrap in `<span class="mf-latin" lang="en">`, can break onto its own line.
- 64px from head to content.
- Variant **row head** (for product rows): title start-aligned at 36px, "المزيد" link at end (20px/500 ink, brand on hover). 88px to the tiles because pills sit high inside the arches.

## Feature card

```
┌─────────────────┐
│      ( ◉ )      │  96px brand disc, 44px white filled glyph
│                 │
│  شحن سريع       │  22–24px/700, one line, centered
│  نوصل طلبك في  │  18px/1.7 ink, max ~220px, centered
│  أسرع وقت…      │
└─────────────────┘  ↙ violet shadow falls to the end-bottom
```

- `.mf-card`: white, 1px `--color-border`, radius 24px, `--shadow-card`.
- Padding 40px 16px 36px, internal gap 16px, 4-up with 32px gaps, equal heights.
- Content: one benefit each. Title is a short noun phrase (2-4 words); body is one sentence of ≤ 12 words.

## Split story section

- 2 columns, 64px gap. Text at start: H3 (`--type-h3`), brand name on its own line in `--text-brand` + `.mf-latin`, then paragraph `--type-lead-xl`, 32px below.
- Image at end: lifestyle product still life, no container, no radius.
- Keep the paragraph ≤ 5 lines at 1440px; it's large type by design, so it has to be short.

## Product arch tile

```
      ╭─────────╮
    ╭─ [إضافة 🛒] ─╮     pill at top, centered, inside the arch
   │               │
   │   packshot    │    ~150–180px product image, centered
   │               │
   └───────────────┘    4px purple-300 bottom edge
       دلكة سودانية      24px/700, centered, 24px below tile
      ٤٬١٦١٫٤٣ ج.م       24px/400, 12px below name
```

- `.mf-arch`: aspect-ratio 285/315, fill `--color-surface-tint`, 1px `--color-border`, 4px `--mf-purple-300` bottom, top radius 50% / 45%.
- Add pill: height 32px, padding-inline 14px, brand fill, white `--type-label`, cart icon 16px after the label (at end), radius pill, centered 22px from the top. Hover brand-600. After adding: swap label to "تمت الإضافة" with a check icon for 2s.
- The whole tile (image + name) links to the product page; the pill is a separate button, so make sure clicking it doesn't navigate.
- Name and price are outside the arch, centered. For a sale: current price in brand 24px/700, old price 18px stone with line-through, at start of the current price.
- 4-up, 32px gap. On mobile: horizontal scroll-snap row with 2.2 tiles visible.

## Comparison panels (before / after)

- 2-up, 32px gap, 508px tall. Order in RTL: **before at start (right), after at end (left)** so the story reads before → after.
- Radius: 40px top corners, 24px bottom corners. `overflow: hidden` so the person cutout clips at the bottom.
- Before: `--color-surface-muted` fill, ink text, label = brand fill + white text.
- After: `--color-brand` fill, white text, label = white fill + brand text. The colors invert between panels; that inversion is the visual "transformation".
- Label: 244×54px, radius 16px, 20px/700. Placed at the top of the copy column.
- Copy column: 260px wide, on the **end** side of the panel, text centered, `--type-lead`, 32px below label. Problem statement in "before", result in "after", both in first person.
- Person cutout at the start side, bleeding off the bottom, ~330×440px. Sparkle ✦ near the person's shoulder at the bottom.

## Testimonial card

- `.mf-card` with radius 24px, padding 96px 24px 28px, centered content.
- Avatar: 136px circle overlapping the top edge by ~78px, 5px brand ring. Fallback when there's no photo: tint fill with the first letter in brand 44px/800.
- Stars: 5 × 18px, 3px gap, filled amber, empty ones pebble outline. Wrap in `role="img"` with `aria-label="التقييم ٤ من ٥"`.
- Headline 22px/700 (a short summary of the review), quote 18px/1.7 inside «…» guillemets, reviewer name 16px/500 start-aligned 24px below.
- 3-up with 110px gaps and ~150px top margin to clear avatars.

## Carousel pagination

- Pills 56×12px, 10px gap, centered 48px below the cards.
- Inactive: white fill, 1.5px ink outline. Active: brand fill, purple-700 outline.
- Each is a `<button>` with `aria-label` and `aria-current="true"` on the active one. Hit area padded to at least 24px tall.
- In RTL the first slide's dot is at the start (right).

## Footer

- `--color-brand`, white text, padding 80px top / 32px bottom.
- 4 columns at start→end: **about** (logo, 16px paragraph, social circles), **important links**, **contact**, **send us a message**.
- Column title: 20px/700 with a 1.5px white underline that extends past the text (padding-inline-end 48px), 32px below.
- Link list: 20px/700, 24px apart, each preceded by a small white triangle pointing in the reading direction (◀ in RTL).
- Contact values (phones, email, URLs) are wrapped in `dir="ltr"` so digits and "@" don't reorder.
- Social: 48px white circles, brand glyph 20px, 12px gap. Hover tint. Each needs an Arabic `aria-label`.
- Message form: 44px input (radius 8px, white) + 44px white "إرسال" button with brand text.
- Bottom: 1.5px white divider 64px below columns, then centered "© ٢٠٢٥ مون فلاور. جميع الحقوق محفوظة." in 16px.

## Buttons

| Kind | Look | Use |
|---|---|---|
| On-brand primary | White fill, brand text 24px/700, 60px, radius 16 | Main CTA on purple blocks |
| Primary | Brand fill, white text, radius 16 (large) or pill (small) | Main CTA on white; add to cart |
| Label / chip | Brand or white fill, 20px/700, radius 16, not clickable | Panel labels |
| Text link | Ink 20px/500, brand on hover | "المزيد", secondary navigation |
| Icon circle | 48px white circle, brand glyph | Social links |

Sizes: large 60px (hero), medium 48px (forms, PDP), small 32px (pills in tiles). Minimum touch target 44px; small pills get extra invisible padding on mobile.

## Form fields

The source only shows the footer input. Derived spec for full forms (checkout, signup):
- Height 52px, radius 16px, white fill, 1px `--color-border`, 18px text, placeholder stone.
- Label above, 16px/700 ink, 8px gap. Helper/error below in 14px.
- Focus: border brand + `0 0 0 4px var(--mf-purple-50)` halo.
- Error: border and message in #C0392B (a warm red that sits well with the violet; 5.4:1 on white), with an icon, never color alone.
- On purple (footer): white fill, radius 8px, 44px.

## States

- **Hover**: brand fills → purple-600; white buttons on brand → purple-50; cards → `--shadow-card-hover` + `translateY(-4px)`; links → brand color.
- **Focus**: 3px purple-300 outline with 3px offset (visible on both white and purple).
- **Active/pressed**: `scale(.98)`, 150ms.
- **Disabled**: purple-100 fill, pebble text, no shadow.
- **Loading** (add to cart): pill keeps its width, label replaced by a 16px white spinner.
- **Empty** (no products, empty cart): centered tint arch placeholder with a 24px/700 message and a primary button that leads somewhere ("تصفّحي المنتجات").

## Extending the system

Derive new screens from the same moves: purple bookends, white middle, arch for product imagery, violet-shadow cards for information, inverted color for transformation.

- **Product page (PDP)**: gallery inside a large arch (start side), details at end: name `--type-h3`, price `--type-lead` 700 in brand, quantity stepper (pill, 48px, tint fill, brand +/−), primary button 60px full width, benefits as small feature cards 3-up below.
- **Category page**: row head + filter pills (tint fill, brand text, active = brand fill/white), product arch grid 4-up, pagination dots or numbered pills.
- **Cart / checkout**: white cards with violet shadow for line items (72px tint arch thumbnail), summary card sticky at end with brand primary button. Currency always "ج.م" after the amount.
- **Badges** ("جديد", "خصم ٢٠٪"): pill 28px, 14px/700; new = brand fill, sale = white fill with brand border. Positioned top-start inside the arch, below the add pill row.
- **Toasts**: white card, radius 16px, violet shadow, 4px brand bar on the start edge, 16px text, auto-dismiss 4s.
- **Modals**: white, radius 24px, padding 40px, backdrop rgba(33,24,60,.55), title 32px/800 centered.
- **Mobile** (< 768px): top bar keeps logo + cart + menu icon, search moves under it full width; hero stacks image above text and centers the text, wave height 40px; feature cards 2-up; products horizontal scroll; comparison panels stack (before first); testimonials become a 1-up swipe carousel; footer stacks with about last. Scale `--type-display` to 32, `--type-h2` to 28, `--type-lead-xl` to 22, `--section-y` to 72px.
