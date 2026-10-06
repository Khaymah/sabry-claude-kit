# Moonflower — content, copy, and known issues

Read this before writing any Arabic copy for the system, formatting prices or phone numbers, or when building directly from the original mock (it contains errors that should not be copied).

## Contents
1. Voice
2. Arabic writing rules
3. Numbers, prices, contact data
4. Accessibility in Arabic
5. Audit of the source mock (fix these)

---

## 1. Voice

- **Audience**: women caring for their skin. Address the reader in the feminine singular: امنحي، اكتشفي، تسوّقي، شاركينا، لكِ.
- **Register mix**: headlines and UI labels in light Modern Standard Arabic ("امنحي بشرتك العناية التي تستحقها"); storytelling and testimonials may lean Egyptian colloquial for warmth ("خلّي جمالك الطبيعي يزهر"، "بقت"، "كتير"). Pick one register per block and don't switch mid-sentence.
- **Tone**: gentle, reassuring, benefit-first. Claims stay modest and believable ("لاحظت فرق في النضارة"), never medical ("يعالج"، "يشفي").
- **CTAs** say what happens: تسوّقي الآن، أضيفي للسلة، اكتشفي المجموعة، أرسلي. Avoid vague "اضغط هنا".

## 2. Arabic writing rules

- **Hamzat al-qat'**: أ/إ/آ where required. الأكثر، إضافة، أرسل، إلينا، آراء، الآن، أونلاين.
- **Taa marbuta vs haa**: دلكة سودانية (not دلكه سودانيه)، إزالة (not ازاله).
- **Tanween**: مبيعًا، نقدًا، دائمًا. Put the fatha-tanween on the letter before the alif (مبيعًا), and never use "آ" as a substitute (مبيعآ is wrong).
- **Shadda** only where it prevents misreading or adds meaning: فعّالة، تسوّقي، مقشّرات، توحّد.
- **Punctuation**: Arabic comma "،" and question mark "؟". No space before a period or comma ("تستحقها." not "تستحقها ."). Use «…» for quotes in testimonials.
- **Spacing**: one space after the prefix "بـ" is wrong; write "بإزالة" not "بـ ازاله".
- **Latin inside Arabic**: wrap brand names in `<span lang="en">` so screen readers switch voice and bidi stays stable. The brand is "Moon Flower" (two words) in running text, "moonflower" (one word, lowercase) only in the logo.

## 3. Numbers, prices, contact data

- **Digits**: the source uses Arabic-Indic digits (٠-٩) for prices and percentages. Keep them for display text on this brand; keep Western digits in phone numbers, emails, and URLs.
- **Separators** with Arabic-Indic digits: thousands "٬" (U+066C), decimal "٫" (U+066B). `٤٬١٦١٫٤٣ ج.م`, not `٤١٦١,٤٣`.
- **Percent**: "٪" (U+066A) after the number: ١٠٠٪.
- **Currency**: "ج.م" after the amount with a space. `new Intl.NumberFormat('ar-EG', { style: 'currency', currency: 'EGP' }).format(4161.43)` gives the right digits and separators but returns `‏٤٬١٦١٫٤٣ ج.م.‏` (with invisible RLM marks and a trailing period). To match the design, format the number and append the symbol yourself:
  ```ts
  const nf = new Intl.NumberFormat('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  export const formatPrice = (v: number) => `${nf.format(v)} ج.م`; // "٤٬١٦١٫٤٣ ج.م"
  ```
- **Phones/emails/URLs**: render inside `dir="ltr"` (or `<bdi>`), group phone digits for readability (+966 54 983 7277), and make them real links (`tel:`, `mailto:`, `https://t.me/…`).
- **Market consistency**: currency, phone country code, and shipping promises must describe the same market. (The source mixes Egyptian pounds with Saudi phone numbers; confirm with the client which is right.)

## 4. Accessibility in Arabic

- `<html lang="ar" dir="rtl">` on every page.
- All `aria-label`s and `alt` text in Arabic, describing the content ("كريم التفتيح من مون فلاور، عبوة ٢٥٠ مل").
- Star ratings: `role="img" aria-label="التقييم ٤ من ٥"`, since amber stars on white don't reach 3:1.
- Directional icons (arrows, chevrons, carousel next/prev, the wave) mirror in RTL; logos, checkmarks, the cart, and play icons don't.
- Carousel: pause auto-rotation on hover/focus, buttons for prev/next, `aria-live="polite"` on the slide region.

## 5. Audit of the source mock (fix these)

These are errors in the original design file. The reference page in `assets/` already applies the fixes. When a user asks you to build "exactly like the design", still apply category A and B fixes and mention them briefly; ask before changing C items, since they involve business content.

### A. Content logic

1. **Before/after copy is swapped.** The "قبل العناية" panel (frowning woman) carries the *result* text ("استرجعت نضارتي…") and the "بعد العناية" panel (smiling woman holding the cream) carries the *problem* text ("بشرتي بهتت…"). Swap the paragraphs.
2. **Placeholder copy from an unrelated education product.** The "ما الذي يميزنا؟" subtitle talks about courses in programming, design, and languages, and all three testimonials praise "الدورات" and "المدربين". Replace with skincare copy.
3. **Testimonials don't match the audience or the data.** The copy addresses women, while the reviews come from three men with course-related quotes, and all three show exactly 3/5 stars. Showcase reviews should come from real customers of these products, with their actual ratings.

### B. Spelling and typography

| In the source | Correct |
|---|---|
| Moon Flawer | Moon Flower |
| منتجاتنا الاكثر مبيعآ | منتجاتنا الأكثر مبيعًا |
| اراء العملاء | آراء العملاء |
| شارك رائيك | شاركينا رأيك |
| سجل الان | تسوّقي الآن (the hero sells products; "register" is the wrong action) |
| اضافة | إضافة |
| دلكه سودانيه | دلكة سودانية |
| تستحقها . | تستحقها. |
| ارسل الينا معلومات تواصلك | أرسلي لنا بيانات تواصلك |
| تـجر مختص بـ ازاله التصبغات | متجر متخصص في إزالة التصبغات |
| بصناعه / طبيعيه | بصناعة / طبيعية |
| نحن دائما  متواجدون (double space) | نحن متواجدون دائمًا |
| سياسات الاسترجاع و الاستبدال (breaks after "و") | الاسترجاع والاستبدال |
| ٤١٦١,٤٣ ج.م | ٤٬١٦١٫٤٣ ج.م |
| Copyright&2025 | © ٢٠٢٥ مون فلاور. جميع الحقوق محفوظة. |

### C. Data and UI consistency (confirm with client)

1. Footer lists the same phone number twice; show one, or label them (مبيعات / دعم).
2. Two LinkedIn icons in the social row; the second is probably meant to be another network (TikTok is common for this category).
3. Currency is EGP (ج.م) but phones are Saudi (+966).
4. Testimonial card radius (~12px) and shadow color (greenish grey) differ from feature cards (24px, violet). The system standardizes on 24px and violet.
5. All four best sellers show the same price; ensure real prices are wired in.
6. The nav has no active/current state; the system adds one (brand color + underline).
7. Footer message input is ~30px tall with 10px text, too small to use; the system uses 44px and 16px.
