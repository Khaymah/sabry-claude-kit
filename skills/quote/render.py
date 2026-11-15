#!/usr/bin/env python3
"""
Renders a technical and financial offer (عرض فني ومالي) from a JSON file into HTML and PDF,
always in the owner's fixed layout.

    render.py <offer.json> [--out DIR] [--check] [--html-only]
    render.py identities                       the sender identities on file
    render.py add-identity '<json>'            adds or replaces one (key, name, signer, ...)
    render.py example                          path of the reference example, if the owner has one

The model writes the words; this script owns the layout and the numbers. Section headings,
their order and the styling are fixed here, so every offer looks the same. Totals per system,
the grand total, the bundle discount, the validity end date and the payment percentages are
computed here, and no PDF is produced while the data is incomplete, a gap marker `[[...]]`
is left, or the payments do not add up to 100%.

Identities and the reference example are the owner's private data: they live in
~/.agents/quote/ (or in the synced `sabry-profile` skill), never in the kit.

PDF needs Chrome, Chromium, Edge or chrome-headless-shell 131 or newer (page numbers use CSS page
margin boxes); a headless shell is preferred when one is installed. QUOTE_CHROME points at one explicitly.
"""
import datetime
import glob
import html
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, "assets")
MONTHS = ("يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر",
          "نوفمبر", "ديسمبر")
ORDINALS = ("الأولى", "الثانية", "الثالثة", "الرابعة", "الخامسة", "السادسة", "السابعة", "الثامنة",
            "التاسعة", "العاشرة", "الحادية عشرة", "الثانية عشرة")
GAP = re.compile(r"\[\[[^\]]*\]\]")
DEFAULT_CLOSING = ["ونتشرف بتقديم عرض لمنهجية التنفيذ وتصميم النظام لسيادتكم في الموعد الذي ترونه مناسباً.",
                   "وتفضلوا بقبول فائق الاحترام والتقدير،"]


class OfferError(Exception):
    pass


def home():
    return os.path.expanduser("~")


def private_dirs():
    """~/.agents/quote first, then the copy synced inside the sabry-profile skill."""
    dirs = [os.path.join(home(), ".agents", "quote")]
    config = os.environ.get("CLAUDE_CONFIG_DIR") or os.path.join(home(), ".claude")
    found = glob.glob(os.path.join(config, "skills", "synced", "*", "sabry-profile", "quote"))
    found += glob.glob(os.path.join(config, "skills", "sabry-profile", "quote"))
    dirs += sorted(found, key=os.path.getmtime, reverse=True)
    return [d for d in dirs if os.path.isdir(d)] or dirs[:1]


def load_identities():
    merged = {}
    for d in reversed(private_dirs()):
        try:
            with open(os.path.join(d, "identities.json"), encoding="utf-8") as fh:
                data = json.load(fh)
            if isinstance(data, dict):
                merged.update({k: v for k, v in data.items() if isinstance(v, dict)})
        except (OSError, ValueError):
            continue
    return merged


def add_identity(raw):
    entry = json.loads(raw)
    key = str(entry.pop("key", "") or "").strip()
    missing = [f for f in ("name", "signer") if not str(entry.get(f, "")).strip()]
    if not re.fullmatch(r"[a-z0-9_-]{2,32}", key) or missing:
        raise OfferError("add-identity needs a lowercase `key` and at least `name` and `signer`")
    path = os.path.join(home(), ".agents", "quote", "identities.json")
    current = {}
    try:
        with open(path, encoding="utf-8") as fh:
            current = json.load(fh)
    except (OSError, ValueError):
        pass
    if not isinstance(current, dict):
        current = {}
    current[key] = entry
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(current, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    return path


def example_paths():
    out = []
    for d in private_dirs():
        out += sorted(glob.glob(os.path.join(d, "examples", "*.json")))
    return out


def esc(text):
    """Escape, then allow **bold** only."""
    safe = html.escape(str(text or ""), quote=False)
    return re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", safe)


def money(value):
    return f"{int(value):,}"


def arabic_date(value):
    d = datetime.date.fromisoformat(str(value))
    return f"{d.day} {MONTHS[d.month - 1]} {d.year}"


def days_phrase(n):
    if n == 1:
        return "يوم واحد"
    if n == 2:
        return "يومان"
    if 3 <= n <= 10:
        return f"{n} أيام"
    return f"{n} يوماً"


def ordinal(i):
    return ORDINALS[i] if i < len(ORDINALS) else f"رقم {i + 1}"


def gaps(value, path="offer"):
    found = []
    if isinstance(value, str):
        found += [f"{path}: {m}" for m in GAP.findall(value)]
    elif isinstance(value, dict):
        for k, v in value.items():
            found += gaps(v, f"{path}.{k}")
    elif isinstance(value, list):
        for i, v in enumerate(value):
            found += gaps(v, f"{path}[{i}]")
    return found


def require(cond, message, problems):
    if not cond:
        problems.append(message)


def compute(offer, identities):
    """Validates the offer and returns the numbers the layout uses. Raises OfferError with
    every problem at once, so the model can fix them in one pass."""
    problems = []
    identity = identities.get(str(offer.get("identity", "")))
    require(identity, f"identity `{offer.get('identity')}` is not on file (render.py identities)", problems)
    for field in ("ref", "date", "subject", "intro"):
        require(str(offer.get(field, "")).strip(), f"`{field}` is required", problems)
    try:
        date = datetime.date.fromisoformat(str(offer.get("date")))
    except ValueError:
        date = None
        problems.append("`date` must be YYYY-MM-DD")
    recipient = offer.get("recipient") or {}
    require(str(recipient.get("org", "")).strip(), "`recipient.org` is required", problems)

    systems = offer.get("systems") or []
    require(isinstance(systems, list) and systems, "`systems` needs at least one system with priced items", problems)
    totals = []
    for i, system in enumerate(systems if isinstance(systems, list) else []):
        items = system.get("items") or []
        require(str(system.get("name", "")).strip(), f"systems[{i}].name is required", problems)
        require(items, f"systems[{i}] has no items", problems)
        total = 0
        for j, item in enumerate(items):
            price = item.get("price")
            ok = isinstance(price, int) and not isinstance(price, bool) and price > 0
            require(ok, f"systems[{i}].items[{j}].price must be a positive whole number", problems)
            require(str(item.get("name", "")).strip(), f"systems[{i}].items[{j}].name is required", problems)
            total += price if ok else 0
        totals.append(total)
    grand = sum(totals)

    discount = offer.get("bundle_discount") or {}
    discounted = None
    if discount:
        pct = discount.get("percent")
        require(isinstance(pct, (int, float)) and 0 < pct < 100, "`bundle_discount.percent` must be between 0 and 100", problems)
        step = int(discount.get("round_to") or 1000)
        if isinstance(pct, (int, float)) and 0 < pct < 100 and step > 0:
            discounted = int(grand * (100 - pct) / 100) // step * step

    payments = (offer.get("financial") or {}).get("payments") or []
    pct_sum = sum(p.get("percent", 0) for p in payments if isinstance(p.get("percent"), (int, float)))
    require(payments, "`financial.payments` is required", problems)
    require(abs(pct_sum - 100) < 1e-9, f"payment percentages add up to {pct_sum}%, not 100%", problems)

    technical = offer.get("technical") or {}
    basis = technical.get("basis")
    require(basis in ("rfp", "scope"), "`technical.basis` must be `rfp` (compliance matrix) or `scope`", problems)
    require(technical.get("compliance" if basis == "rfp" else "scope"),
            f"`technical.{'compliance' if basis == 'rfp' else 'scope'}` is required for basis `{basis}`", problems)
    require((technical.get("understanding") or {}).get("intro"), "`technical.understanding.intro` is required", problems)
    require(technical.get("timeline"), "`technical.timeline` is required", problems)

    validity = offer.get("validity_days")
    require(isinstance(validity, int) and validity > 0, "`validity_days` must be a positive whole number", problems)
    maintenance = offer.get("maintenance_annual")
    require(maintenance is None or (isinstance(maintenance, int) and maintenance >= 0),
            "`maintenance_annual` must be a whole number", problems)

    problems += [f"unresolved gap {g}" for g in gaps(offer)]
    if problems:
        raise OfferError("\n".join(f"- {p}" for p in problems))
    return {"identity": identity, "date": date, "totals": totals, "grand": grand, "discounted": discounted,
            "valid_until": date + datetime.timedelta(days=validity), "payments_total": pct_sum}


def currency(offer, identity):
    cur = offer.get("currency") or identity.get("currency") or {}
    return {"unit": cur.get("unit", "جنيه"), "full": cur.get("full", "الجنيه المصري")}


def system_label(count):
    return "إجمالي النظامين" if count == 2 else "إجمالي الأنظمة" if count > 2 else "الإجمالي"


def letterhead(offer, c):
    ident = c["identity"]
    return f"""
<header class="letterhead">
  <div>
    <div class="brand-name">{esc(ident.get("name"))}</div>
    <div class="brand-tag">{esc(ident.get("tagline", ""))}</div>
  </div>
  <div class="meta">
    <div>المرجع: <span class="ltr">{esc(offer["ref"])}</span></div>
    <div>التاريخ: {arabic_date(offer["date"])}</div>
  </div>
</header>"""


def cover(offer, c):
    cur = currency(offer, c["identity"])
    r = offer.get("recipient") or {}
    systems = offer["systems"]
    rows = [(s["name"], f"{money(t)} {cur['unit']}", "") for s, t in zip(systems, c["totals"])]
    if len(systems) > 1:
        rows.append((system_label(len(systems)), f"{money(c['grand'])} {cur['unit']}", "hl"))
    if c["discounted"] is not None:
        d = offer["bundle_discount"]
        label = d.get("label", "في حالة الترسية على كل الأنظمة معاً")
        rows.append((f"{label} (خصم {d['percent']:g}%)", f"{money(c['discounted'])} {cur['unit']}", ""))
    if offer.get("duration"):
        rows.append(("مدة التنفيذ", offer["duration"], ""))
    if offer.get("warranty"):
        rows.append(("الضمان بعد التسليم", offer.get("warranty_cover") or offer["warranty"], ""))
    if offer.get("maintenance_annual") is not None:
        rows.append(("الصيانة والدعم الفني السنوي", f"{money(offer['maintenance_annual'])} {cur['unit']} سنوياً", ""))
    rows.append(("صلاحية العرض", f"{days_phrase(offer['validity_days'])} من تاريخه", ""))
    table = "".join(f'<tr class="{cls}"><td>{esc(a)}</td><td class="v">{esc(b)}</td></tr>' for a, b, cls in rows)
    attention = ""
    if r.get("attention"):
        attention = (f'<div>عناية {esc(r.get("attention_prefix", "السيد الأستاذ"))} / <strong>{esc(r["attention"])}</strong>'
                     + (f' — {esc(r["attention_title"])}' if r.get("attention_title") else "") + "</div>")
    closing = "".join(f"<p>{esc(p)}</p>" for p in (offer.get("cover_closing") or DEFAULT_CLOSING))
    includes = f'<p>{esc(offer["cover_includes"])}</p>' if offer.get("cover_includes") else ""
    return f"""
{letterhead(offer, c)}
<section class="to">
  <div>{esc(r.get("salutation", "السادة"))} / <strong>{esc(r["org"])}</strong></div>
  {attention}
</section>
<p class="greeting">{esc(offer.get("greeting", "تحية طيبة وبعد،"))}</p>
<div class="subject">الموضوع: {esc(offer["subject"])}</div>
<p>{esc(offer["intro"])}</p>
<p>{esc(offer.get("summary_lead", "وفيما يلي ملخص العرض:"))}</p>
<table class="kv"><tbody>{table}</tbody></table>
<div class="caption">الأسعار ب{esc(cur["full"])}.</div>
{includes}
<div class="closing">{closing}</div>
{signature(c, contact=True)}"""


def signature(c, contact=False, date_text=""):
    ident = c["identity"]
    left = ""
    if contact:
        parts = []
        if ident.get("phone"):
            parts.append(f'<div><span class="label">{esc(ident.get("phone_label", "هاتف / واتساب"))}:</span> '
                         f'<span class="ltr">{esc(ident["phone"])}</span></div>')
        if ident.get("email"):
            parts.append(f'<div><span class="label">البريد:</span> <span class="ltr">{esc(ident["email"])}</span></div>')
        left = "".join(parts)
    elif date_text:
        left = f'<div><span class="label">التاريخ: {esc(date_text)}</span></div>'
    return f"""
<div class="sign">
  <div class="who"><div class="ltr">{esc(ident.get("name"))}</div><div>{esc(ident.get("signer"))}</div></div>
  <div class="contact">{left}</div>
</div>"""


def labelled_list(items):
    rows = []
    for it in items or []:
        if isinstance(it, dict):
            label = f"<strong>{esc(it.get('label'))}:</strong> " if it.get("label") else ""
            rows.append(f"<li>{label}{esc(it.get('text', ''))}</li>")
        else:
            rows.append(f"<li>{esc(it)}</li>")
    return f"<ul>{''.join(rows)}</ul>" if rows else ""


def technical(offer):
    t = offer["technical"]
    u = t["understanding"]
    out = ['<section class="part-break"><h1 class="part">أولاً: العرض الفني</h1>',
           '<h2 class="section">1. فهمنا للمطلوب</h2>', f"<p>{esc(u['intro'])}</p>", labelled_list(u.get("bullets"))]
    if u.get("closing"):
        out.append(f"<p>{esc(u['closing'])}</p>")
    if t["basis"] == "rfp":
        out.append('<h2 class="section">2. مصفوفة الالتزام بالمواصفات</h2>')
        for group in t["compliance"]:
            out.append(f'<h3 class="group">{esc(group.get("title"))}</h3>')
            rows = "".join(
                f'<tr><td class="item">{esc((str(i.get("id")) + " ") if i.get("id") else "")}{esc(i.get("name"))}</td>'
                f'<td class="status">{esc(i.get("status", "ملتزم"))}</td><td>{esc(i.get("how", ""))}</td></tr>'
                for i in group.get("items", []))
            out.append(f'<table class="grid"><thead><tr><th>البند</th><th>الالتزام</th><th>طريقة التنفيذ</th></tr>'
                       f"</thead><tbody>{rows}</tbody></table>")
    else:
        out.append('<h2 class="section">2. نطاق العمل</h2>')
        for group in t["scope"]:
            out.append(f'<h3 class="group">{esc(group.get("title"))}</h3>')
            rows = "".join(f'<tr><td class="item">{esc(i.get("name"))}</td><td>{esc(i.get("how", ""))}</td></tr>'
                           for i in group.get("items", []))
            out.append(f'<table class="grid"><thead><tr><th>البند</th><th>الوصف</th></tr></thead><tbody>{rows}</tbody></table>')
    out.append('<h2 class="section">3. البنية التقنية</h2>' + labelled_list(t.get("architecture")))
    rows = "".join(f'<tr><td class="phase">{esc(p.get("phase"))}</td><td class="when">{esc(p.get("when"))}</td>'
                   f'<td>{esc(p.get("outputs"))}</td></tr>' for p in t["timeline"])
    out.append('<h2 class="section">4. خطة التنفيذ والجدول الزمني</h2>'
               f'<table class="grid"><thead><tr><th>المرحلة</th><th>التوقيت</th><th>المخرجات</th></tr></thead>'
               f"<tbody>{rows}</tbody></table>")
    if t.get("timeline_note"):
        out.append(f"<p>{esc(t['timeline_note'])}</p>")
    out.append('<h2 class="section">5. التدريب والتوثيق والضمان والدعم</h2>' + labelled_list(t.get("support")))
    out.append("</section>")
    return "\n".join(out)


def financial(offer, c):
    f = offer.get("financial") or {}
    cur = currency(offer, c["identity"])
    systems = offer["systems"]
    out = ['<section class="part-break"><h1 class="part">ثانياً: العرض المالي</h1>']
    if f.get("intro"):
        out.append(f'<div class="caption">{esc(f["intro"])}</div>')
    for system, total in zip(systems, c["totals"]):
        rows = "".join(f'<tr><td class="num">{n}</td><td>{esc(i["name"])}</td><td class="price">{money(i["price"])}</td></tr>'
                       for n, i in enumerate(system["items"], 1))
        out.append(f'<h2 class="section">{esc(system["name"])}</h2>'
                   f'<table class="grid"><thead><tr><th class="num">#</th><th>المكوّن</th>'
                   f'<th class="price">السعر ({esc(cur["unit"])})</th></tr></thead><tbody>{rows}'
                   f'<tr class="total"><td></td><td>الإجمالي</td><td class="price">{money(total)}</td></tr></tbody></table>')
    if len(systems) > 1 or c["discounted"] is not None:
        rows = [(s["name"], money(t), "") for s, t in zip(systems, c["totals"])]
        rows.append((system_label(len(systems)), money(c["grand"]), "hl"))
        if c["discounted"] is not None:
            d = offer["bundle_discount"]
            label = d.get("label_financial") or f"{system_label(len(systems))} {d.get('label', '')}".strip()
            rows.append((f"{label} (بعد خصم {d['percent']:g}%)", money(c["discounted"]), "hl"))
        body = "".join(f'<tr class="{cls}"><td>{esc(a)}</td><td class="price">{b}</td></tr>' for a, b, cls in rows)
        out.append(f'<div class="keep"><h2 class="section">الإجمالي العام</h2><table class="sum"><tbody>{body}</tbody></table></div>')
    extra = []
    if offer.get("duration_short") or offer.get("duration"):
        extra.append(("مدة التنفيذ المتوقعة", offer.get("duration_short") or offer["duration"]))
    if offer.get("maintenance_annual") is not None:
        extra.append((f"تكلفة الصيانة والدعم الفني السنوية بعد التسليم ({cur['unit']})", money(offer["maintenance_annual"])))
    if offer.get("warranty"):
        extra.append(("مدة الضمان بعد التسليم", offer["warranty"]))
    extra.append(("مدة صلاحية العرض", f"{days_phrase(offer['validity_days'])} من تاريخه (حتى {arabic_date(c['valid_until'])})"))
    extra += [(e.get("item"), e.get("value")) for e in f.get("extra", [])]
    body = "".join(f"<tr><td>{esc(a)}</td><td>{esc(b)}</td></tr>" for a, b in extra)
    out.append(f'<div class="keep"><h2 class="section">بنود إضافية</h2><table class="grid"><thead><tr><th>البند</th>'
               f"<th>القيمة</th></tr></thead><tbody>{body}</tbody></table></div>")
    body = "".join(f'<tr><td>{ordinal(i)}</td><td>{esc(p.get("due"))}</td><td class="pct">{p["percent"]:g}%</td></tr>'
                   for i, p in enumerate(f["payments"]))
    note = f'<div class="caption">{esc(f["payments_note"])}</div>' if f.get("payments_note") else ""
    out.append(f'<div class="keep"><h2 class="section">شروط الدفع</h2><table class="grid"><thead><tr><th>الدفعة</th>'
               f'<th>الاستحقاق</th><th class="pct">النسبة</th></tr></thead><tbody>{body}</tbody></table>{note}</div>')
    if f.get("includes"):
        out.append('<h2 class="section">ما يشمله العرض</h2>' + labelled_list(f["includes"]))
    if f.get("excludes"):
        out.append('<h2 class="section">ما لا يشمله العرض</h2>' + labelled_list(f["excludes"]))
    if f.get("assumptions"):
        intro = f.get("assumptions_intro") or ("بُني هذا العرض على الافتراضات التالية. في حال اختلفت المعلومات التي "
                                               "توفرها الجهة عنها، قد يترتب على ذلك تكلفة إضافية أو تعديل في المدة، "
                                               "ويتم الاتفاق على ذلك كتابياً قبل بدء العمل، ولا يُضاف أي مبلغ دون موافقة مسبقة.")
        rows = "".join(f'<tr><td class="num">{n}</td><td class="item">{esc(a.get("item"))}</td><td>{esc(a.get("value"))}</td></tr>'
                       for n, a in enumerate(f["assumptions"], 1))
        out.append('<div class="keep"><h2 class="section">بنود تحتاج إلى توضيح قبل بدء العمل</h2>'
                   f'<div class="note">{esc(intro)}</div>'
                   f'<table class="grid"><thead><tr><th class="num">#</th><th>البند</th><th>الافتراض الذي بُني عليه العرض</th>'
                   f"</tr></thead><tbody>{rows}</tbody></table></div>")
    terms = [f"الأسعار ب{cur['full']}."] + list(f.get("terms") or [])
    out.append('<div class="keep"><h2 class="section">أحكام عامة</h2>' + labelled_list(terms)
               + signature(c, date_text=arabic_date(offer["date"])) + "</div>")
    out.append("</section>")
    return "\n".join(out)


def build_html(offer, c):
    with open(os.path.join(ASSETS, "quote.css"), encoding="utf-8") as fh:
        css = fh.read()
    fonts = "file://" + os.path.join(ASSETS, "fonts").replace("\\", "/")
    if not fonts.startswith("file:///"):
        fonts = fonts.replace("file://", "file:///")
    footer = f"{c['identity'].get('name', '')} — {offer['ref']}".replace('"', "'")
    css = css.replace("{fonts}", fonts).replace("{footer}", footer)
    title = html.escape(f"{offer.get('title') or offer['subject']}")
    return (f'<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>{title}</title>'
            f"<style>{css}</style></head><body>{cover(offer, c)}{technical(offer)}{financial(offer, c)}</body></html>")


def find_chrome():
    explicit = os.environ.get("QUOTE_CHROME")
    if explicit and os.path.isfile(explicit):
        return explicit
    shells = sorted(glob.glob("/opt/pw-browsers/chromium_headless_shell-*/chrome-*/chrome-headless-shell"), reverse=True)
    shells += sorted(glob.glob(os.path.join(home(), ".cache", "ms-playwright", "chromium_headless_shell-*", "chrome-*",
                                            "chrome-headless-shell*")), reverse=True)
    shells += sorted(glob.glob(os.path.join(os.environ.get("LOCALAPPDATA", home()), "ms-playwright",
                                            "chromium_headless_shell-*", "chrome-*", "chrome-headless-shell.exe")),
                     reverse=True)
    if shells:
        return shells[0]
    for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome", "msedge",
                 "microsoft-edge"):
        found = shutil.which(name)
        if found:
            return found
    candidates = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ]
    candidates += sorted(glob.glob("/opt/pw-browsers/chromium-*/chrome-linux*/chrome"), reverse=True)
    candidates += sorted(glob.glob(os.path.join(home(), ".cache", "ms-playwright", "chromium-*", "chrome-*", "chrome")),
                         reverse=True)
    return next((c for c in candidates if os.path.isfile(c)), None)


def print_pdf(html_path, pdf_path):
    chrome = find_chrome()
    if not chrome:
        raise OfferError("no Chrome, Chromium or Edge found for the PDF; install one or set QUOTE_CHROME. "
                         f"The HTML is ready: {html_path}")
    profile = tempfile.mkdtemp(prefix="quote-chrome-")
    args = [chrome, "--headless=new", "--disable-gpu", "--no-pdf-header-footer", "--hide-scrollbars",
            "--run-all-compositor-stages-before-draw", "--virtual-time-budget=10000",
            f"--user-data-dir={profile}", f"--print-to-pdf={pdf_path}", "file://" + os.path.abspath(html_path)]
    if os.name == "posix" and hasattr(os, "geteuid") and os.geteuid() == 0:
        args.insert(1, "--no-sandbox")
    try:
        p = subprocess.run(args, capture_output=True, text=True, timeout=120)
    except subprocess.TimeoutExpired:
        raise OfferError(f"{os.path.basename(chrome)} did not finish the PDF in 2 minutes (a full Chrome can hang "
                         "without a display); point QUOTE_CHROME at chrome-headless-shell, or open the HTML and "
                         f"print it to PDF: {html_path}")
    finally:
        shutil.rmtree(profile, ignore_errors=True)
    if not os.path.isfile(pdf_path) or os.path.getsize(pdf_path) == 0:
        raise OfferError("the browser did not write the PDF:\n" + (p.stderr or p.stdout)[-800:])


def slug(text):
    return re.sub(r"[^A-Za-z0-9._-]+", "-", str(text)).strip("-") or "offer"


def render(path, out_dir=None, check=False, html_only=False):
    with open(path, encoding="utf-8") as fh:
        offer = json.load(fh)
    c = compute(offer, load_identities())
    summary = {"ref": offer["ref"], "systems": {s["name"]: t for s, t in zip(offer["systems"], c["totals"])},
               "grand_total": c["grand"], "after_discount": c["discounted"],
               "valid_until": c["valid_until"].isoformat(), "payments_total_percent": c["payments_total"]}
    if check:
        return summary
    out_dir = out_dir or os.path.dirname(os.path.abspath(path))
    os.makedirs(out_dir, exist_ok=True)
    base = os.path.join(out_dir, slug(offer["ref"]))
    with open(base + ".html", "w", encoding="utf-8") as fh:
        fh.write(build_html(offer, c))
    summary["html"] = base + ".html"
    if not html_only:
        print_pdf(base + ".html", base + ".pdf")
        summary["pdf"] = base + ".pdf"
    return summary


def main():
    args = sys.argv[1:]
    try:
        if not args or args[0] in ("-h", "--help"):
            print(__doc__.strip())
            return 0
        if args[0] == "identities":
            print(json.dumps(load_identities(), indent=2, ensure_ascii=False))
            return 0
        if args[0] == "add-identity":
            print(add_identity(args[1] if len(args) > 1 else sys.stdin.read()))
            return 0
        if args[0] == "example":
            print("\n".join(example_paths()) or "no reference example on file")
            return 0
        out = args[args.index("--out") + 1] if "--out" in args and len(args) > args.index("--out") + 1 else None
        result = render(args[0], out, check="--check" in args, html_only="--html-only" in args)
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return 0
    except OfferError as error:
        print(f"quote: not rendered:\n{error}", file=sys.stderr)
        return 2
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f"quote: {type(error).__name__}: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
