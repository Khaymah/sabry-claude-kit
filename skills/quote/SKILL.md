---
name: quote
description: Produces a technical and financial offer (عرض فني ومالي / عرض سعر) as a PDF in the owner's fixed layout - cover letter with a summary table, technical offer (understanding, compliance matrix or scope, architecture, timeline, training and warranty), financial offer (priced components, totals and bundle discount, payment terms, inclusions, exclusions, assumptions, general terms). Asks the owner whatever it needs at any point; never invents a price, date or scope. Use on /sabry-kit:quote, or when the owner says "عرض سعر" / "عرض فني ومالي" / "اعمل عرض للعميل" / "رد على كراسة الشروط" / "quote" / "proposal" / "offer" / "tender".
argument-hint: "[client or project]"
---

# Quote — technical and financial offer

Reply and ask in the owner's language (profile; default Egyptian Arabic). The offer itself is written in the client's language (Arabic unless the owner says otherwise).

The layout never changes. `render.py` (in this skill's folder) owns the headings, their order, the styling and every computed number; you write the content as JSON. Do not write HTML, do not invent sections, do not compute totals yourself.

## 1. Who is sending it

```bash
python3 "<this skill folder>/render.py" identities
```

- Several identities → ask with `AskUserQuestion` which one sends this offer.
- None, or the owner names a new one → ask for name, tagline, signer, phone, email and reference prefix, then save it:
  `python3 "<this skill folder>/render.py" add-identity '{"key":"…","name":"…","tagline":"…","signer":"…","phone":"…","email":"…","ref_prefix":"…","currency":{"unit":"جنيه","full":"الجنيه المصري"}}'`
- Identities live in the owner's private profile (`~/.agents/quote/`), never in the kit or a project. Remind the owner once that `kit_profile.py bundle` carries them to other machines.

## 2. What you need before writing

Collect these; ask with `AskUserQuestion` whenever one is missing or unclear, at any point, as often as needed. Group questions (up to four per call) to keep it short.

| Needed | Notes |
|---|---|
| Client organisation, the person addressed, their title | From the client's letter if there is one |
| The request: a tender / specification document (كراسة شروط) or not | **Ask every time:** answer item by item in a compliance matrix (`basis: "rfp"`), or describe the scope (`basis: "scope"`) |
| Systems and their priced components | Prices come from the owner. Without them, apply the `business-developer` role (`Roles/Business-Developer.md`, Freelancer-Trap check included) to propose prices, and get the owner's confirmation before they go in |
| Bundle discount, rounding | Default rounding: down to the nearest 1,000 |
| Duration per system and overall, warranty, annual maintenance, validity in days | |
| Payment schedule | Percentages must add up to 100 |
| What is included, what is not, the assumptions the price rests on | Assumptions protect the owner: data volume, hosting, user counts, content, training size, integrations |
| Reference number and date | Reference: `<ref_prefix>-<CLIENT>-<YEAR>-<NN>` unless the owner gives one; date: today unless given |

A fact you cannot get yet goes in as a gap marker `[[what is missing]]`. The renderer refuses to produce the PDF while any marker remains, so it can never reach a client by accident.

Read the reference example for tone and level of detail, never for content:

```bash
python3 "<this skill folder>/render.py" example
```

## 3. Write the offer as JSON

Save it as `quotes/<ref>/offer.json` in the current folder. Inside a git repository, ask first whether that is the right place: an offer holds client data and prices.

```json
{
  "identity": "fsd",
  "ref": "FSD-ABC-2026-01",
  "date": "2026-11-15",
  "recipient": {"salutation": "السادة", "org": "…", "attention_prefix": "السيد الأستاذ", "attention": "…", "attention_title": "…"},
  "subject": "عرض فني ومالي لـ …",
  "intro": "بالإشارة إلى … يسعدنا أن نتقدم … **اسم النظام** …",
  "systems": [{"name": "…", "items": [{"name": "…", "price": 75000}]}],
  "bundle_discount": {"percent": 5, "round_to": 1000, "label": "في حالة الترسية على النظامين معاً", "label_financial": "إجمالي النظامين في حالة الترسية عليهما معاً"},
  "duration": "…", "duration_short": "…",
  "warranty": "6 أشهر", "warranty_cover": "6 أشهر مجاناً",
  "maintenance_annual": 140000,
  "validity_days": 30,
  "cover_includes": "ويشمل العرض …",
  "technical": {
    "basis": "rfp",
    "understanding": {"intro": "…", "bullets": [{"label": "…", "text": "…"}], "closing": "…"},
    "compliance": [{"title": "…", "items": [{"id": "2.1", "name": "…", "status": "ملتزم", "how": "…"}]}],
    "scope": [{"title": "…", "items": [{"name": "…", "how": "…"}]}],
    "architecture": [{"label": "…", "text": "…"}],
    "timeline": [{"phase": "0. التحليل والتصميم", "when": "الشهر الأول", "outputs": "…"}],
    "timeline_note": "…",
    "support": [{"label": "التدريب", "text": "…"}]
  },
  "financial": {
    "intro": "…",
    "payments": [{"due": "دفعة مقدمة عند التعاقد", "percent": 25}],
    "payments_note": "…",
    "includes": ["…"], "excludes": ["…"],
    "assumptions": [{"item": "…", "value": "…"}],
    "terms": ["…"]
  }
}
```

- `compliance` for `basis: "rfp"`, `scope` for `basis: "scope"`; leave the other out.
- `**bold**` is the only formatting. Prices are whole numbers in the currency's unit.
- Optional: `greeting`, `summary_lead`, `cover_closing` (list), `title`, `currency`, `financial.extra` (more rows for "بنود إضافية"), `financial.assumptions_intro`.
- "الأسعار ب…" in the general terms is added by the renderer.

## 4. Check, then render

```bash
python3 "<this skill folder>/render.py" quotes/<ref>/offer.json --check
python3 "<this skill folder>/render.py" quotes/<ref>/offer.json
```

`--check` prints the computed totals: compare them with what the owner gave you before rendering. A refusal lists every problem; fix them all and run again. The PDF and an HTML copy land next to the JSON.

## 5. Verify before handing it over

1. Open the PDF pages (Read with `pages`) and look at them: cover summary, both parts, every table, the signature on the first and last page.
2. Confirm every number in the cover summary matches the financial tables (the renderer computes both from the same data; a mismatch means the JSON is wrong).
3. Read the text once as the client would: no internal notes, no English left in Arabic prose, names spelt as the client spells them.

## 6. Hand over

Give the owner the PDF path, then a short table: reference, client, total, after discount, duration, validity end date, and any assumption worth a second look. **Never send the offer to the client yourself.** Then ask what is next with `AskUserQuestion` (send as is · change something · prepare the cover email with `proposal-writer`).

## Never

- A price, date, duration or scope item the owner did not give or confirm.
- Free-form layout changes: if the owner wants a different section or style, that is a change to `render.py` and `assets/quote.css`, made once, for every offer.
- Client data or prices committed to a public repository.
