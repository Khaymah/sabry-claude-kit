# Arabic RTL and i18n

- **Situation:** Arabic UI (RTL) alone or next to English, language switch, numbers, dates, currency, phone numbers and codes inside Arabic text, icons, fonts.
- **Skip when:** the product is single-language LTR and will stay so (say it in the report).
- **Decision:** logical CSS only (no `left`/`right`), `dir` set per locale on `<html>`, every number, date and amount formatted with `Intl` for the active locale (`ar-EG` for Arabic), text in message catalogs. Formatting here is display only; values stay integers and ISO timestamps on the wire (`backend/data/money.md`, `backend/data/time-zones.md`). The project's i18n library and locale choices win over the defaults below.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Arabic only or English only, one fixed direction |
| Standard | Both languages, switchable, production |
| Advanced | More locales, user-generated multilingual content, PDF or email in both directions |

## Rules

### Minimum — always, never cut

- `<html lang="ar" dir="rtl">` (or `en`/`ltr`) set on the server render from the locale; never toggled with client JS after load.
- No hard-coded user-facing strings in components; all text from the catalog.
- Never build numbers, dates or amounts by string concatenation or `toFixed`.

### Standard — adds

- Tailwind logical utilities only: `ms-*`, `me-*`, `ps-*`, `pe-*`, `start-*`, `end-*`, `text-start`, `text-end`, `border-s`, `border-e`, `rounded-s`, `rounded-e`. Ban `ml-`, `mr-`, `pl-`, `pr-`, `left-`, `right-`, `text-left`, `text-right` with an ESLint rule or a grep in CI. Use `rtl:`/`ltr:` variants only for what logical properties cannot express (transforms).
- Locale code `ar-EG` for Arabic Egypt, `en-US` or `en-GB` for English. Numeral choice is a product decision: `ar-EG` yields Arabic-Indic digits (`١٢٣`) by default; if the owner wants Latin digits in Arabic UI use `ar-EG-u-nu-latn`. Pick one and use it everywhere, including tables and charts.
- Currency: `new Intl.NumberFormat(Locale, { style: "currency", currency: "EGP" }).format(Minor / 100)`, with the exponent from the currency table, not a hard-coded 100 (`backend/data/money.md`). Convert from `bigint` minor units with a decimal-safe helper above 2^53.
- Dates: `Intl.DateTimeFormat(Locale, { timeZone: "Africa/Cairo", dateStyle: "medium" })`. Always pass `timeZone`. Calendar stays Gregorian unless the owner asks for Hijri (`-u-ca-islamic`).
- Plurals: `Intl.PluralRules` or the library's ICU messages; Arabic has six forms (zero, one, two, few, many, other), never `Count === 1 ? … : …`.
- Mixed bidi text: wrap phone numbers, order numbers, emails, URLs, SKUs and codes in `<bdi>` or `<span dir="ltr">` so `+20 10 1234 5678` and `INV-2025-001` do not reorder inside an Arabic sentence. Inputs for these use `dir="ltr"` with `text-start`. User-written text uses `dir="auto"`.
- Icons: flip with the direction when they mean direction (back/forward arrows, chevrons, "next", progress, send, reply, undo/redo, list indents, sliders); do not flip when they are objects or universal (play triangle, clocks, checkmark, search lens, logos, phone, plus, download, media controls, charts with time on the x-axis, brand icons). Flip with `rtl:-scale-x-100`.
- Fonts: an Arabic-capable family loaded with `font-display: swap` and subset (for example Tajawal, Cairo, IBM Plex Sans Arabic). Line-height at least 1.6 for Arabic; never letter-spacing on Arabic (it breaks joining); no `uppercase` effect and no italics.
- Language switch keeps the current page and params, sets a cookie, and re-renders on the server.
- Truncation: `text-overflow: ellipsis` works with `dir`; never cut a string by character count in JS (combining marks).

### Advanced — adds

- Catalogs per locale with a missing-key check in CI; fallback locale shown visibly in development.
- Emails and PDFs render with `dir` and an embedded Arabic font; test shaping (ligatures) in the PDF engine.
- User content stores its own language and `dir` per field.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Arabic sentence containing an English brand and a phone number | Number and brand keep their internal LTR order and stay in the right place in the sentence |
| Arabic-Indic digits typed into a numeric field | Accepted and normalised (`forms.md`) |
| Amount negative or in parentheses in RTL | Sign and currency symbol placed by `Intl`, never by hand; test `-١٥٠٫٥٠ ج.م.‏` |
| Progress bar and slider in RTL | Fill grows from the right; keyboard arrows follow the visual direction |
| Table with an actions column | It sits at the end (left in RTL) automatically through logical order |
| Date at midnight Cairo boundary shown to a user abroad | Shown in Cairo time with the zone name when the viewer's zone differs |
| Data at 100×: 50,000 formatted cells | One `Intl.NumberFormat` instance per locale cached; never `new` inside a row |
| Twice / parallel: user switches language while a request is in flight | The response renders in the new locale; messages come from codes, not server-translated strings captured earlier |
| A translated string longer than the English one | Layout wraps; no fixed widths on buttons and labels |

## Example — Standard, Next.js

```tsx
const Formatters = new Map<string, Intl.NumberFormat>()

export function FormatMoney(Minor: bigint, Currency: string, Locale: string) {
  const Key = `${Locale}:${Currency}`
  let Formatter = Formatters.get(Key)
  if (!Formatter) {
    Formatter = new Intl.NumberFormat(Locale, { style: "currency", currency: Currency })
    Formatters.set(Key, Formatter)
  }
  return Formatter.format(Number(Minor) / 100)
}

export const FormatDate = (Value: string, Locale: string) =>
  new Intl.DateTimeFormat(Locale, { timeZone: "Africa/Cairo", dateStyle: "medium", timeStyle: "short" }).format(new Date(Value))

export function Phone({ Value }: { Value: string }) {
  return <bdi dir="ltr" className="text-start">{Value}</bdi>
}

export default function RootLayout({ children, params }: { children: React.ReactNode; params: { Locale: string } }) {
  const IsArabic = params.Locale === "ar"
  return (
    <html lang={IsArabic ? "ar" : "en"} dir={IsArabic ? "rtl" : "ltr"}>
      <body className="font-sans leading-relaxed">{children}</body>
    </html>
  )
}
```

`Number(Minor) / 100` is safe for display below 2^53 minor units and for 2-decimal currencies; use the currency exponent table otherwise. Other stacks: `next-intl`, `react-i18next` or `vue-i18n` carry the same ICU messages.

## Verify

- [ ] `[M]` The page source has the right `lang` and `dir` before any JS runs.
- [ ] `[S]` Grep finds no `ml-`, `mr-`, `pl-`, `pr-`, `left-`, `right-`, `text-left`, `text-right` in components.
- [ ] `[S]` Switch to Arabic: layout mirrors, arrows point the right way, play and checkmark are unchanged.
- [ ] `[S]` `+20 10 1234 5678` and `INV-2025-001` inside an Arabic sentence read correctly.
- [ ] `[S]` Dates show Cairo day for a timestamp at 23:30 UTC.
- [ ] `[A]` Missing translation key fails CI.

## Pitfalls

- **`ml-4` in an Arabic page** → gap on the wrong side → `ms-4`.
- **Toggling `dir` in a client effect** → flash of wrong layout, hydration warnings → server render.
- **Formatting money with `toFixed(2)`** → no separators, wrong symbol side → `Intl`.
- **Mirroring every icon** → backwards play button → flip only directional icons.
- **`letter-spacing` on Arabic** → letters disconnect → none.

## Related

`frontend/forms.md` · `frontend/accessibility.md` · `frontend/tables-large-data.md` · `backend/data/money.md` · `backend/data/time-zones.md`
