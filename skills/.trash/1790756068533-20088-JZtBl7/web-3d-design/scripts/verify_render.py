#!/usr/bin/env python3
"""
Render a 3D web page in headless Chromium (WebGL via SwiftShader) and check it.

For each viewport it scrolls to every [data-stop] section (or 0/50/100% of the
page if there are none), takes a screenshot, and a second "canvas only"
screenshot with the DOM hidden, then reports:

  - console errors, page errors, failed network requests
  - whether a WebGL canvas exists and its context is alive
  - how much of the canvas actually has rendered content (blank-scene check)
  - the frame rate the headless renderer reached

Software WebGL (SwiftShader) is slow, often 1-5 fps, so eased motion may still be
mid-transition when a screenshot is taken. Check LAYOUT with --reduced-motion (the
scene should then jump straight to each section's pose), and check the LOOK with a
normal run. Don't judge final positions from a low-fps normal run.

It also writes contact_sheet.png with every screenshot in one image. LOOK AT IT
before telling anyone the page works: these numbers catch a blank or crashed
scene, not an ugly one.

Usage:
  python verify_render.py http://localhost:4173 --out ./shots
  python verify_render.py http://localhost:4173 --viewports 1440x900,390x844 --wait 2500
Exit code 1 if any viewport has a blank/missing canvas or page errors.
"""
import argparse
import json
import sys
from pathlib import Path

from PIL import Image, ImageStat
from playwright.sync_api import sync_playwright

CHROMIUM_ARGS = [
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
    "--autoplay-policy=no-user-gesture-required",
]

STOPS_JS = """
() => {
  const els = [...document.querySelectorAll('[data-stop]')];
  const max = document.documentElement.scrollHeight - innerHeight;
  if (!els.length) return [0, Math.round(max / 2), max];
  return els.map(el => {
    const r = el.getBoundingClientRect();
    const center = r.top + scrollY + r.height / 2;
    return Math.max(0, Math.min(max, Math.round(center - innerHeight / 2)));
  });
}
"""

GL_JS = """
() => {
  const c = document.querySelector('canvas');
  if (!c) return { canvas: false };
  const gl = c.getContext('webgl2') || c.getContext('webgl');
  return {
    canvas: true,
    width: c.width, height: c.height,
    context: !!gl,
    lost: gl ? gl.isContextLost() : null,
    renderer: gl ? gl.getParameter(gl.RENDERER) : null,
  };
}
"""

HIDE_DOM_JS = """
(hide) => {
  for (const el of document.querySelectorAll('body *')) {
    if (el.tagName === 'CANVAS' || el.querySelector('canvas') || el.closest('canvas')) continue;
    if (hide) { el.dataset.vrVis = el.style.visibility; el.style.visibility = 'hidden'; }
    else { el.style.visibility = el.dataset.vrVis || ''; delete el.dataset.vrVis; }
  }
}
"""


def content_ratio(path: Path, threshold: int = 45) -> float:
    """Share of pixels brighter than `threshold` (0-255 luma): ~0 means nothing rendered."""
    img = Image.open(path).convert("L")
    hist = img.histogram()
    total = sum(hist)
    return sum(hist[threshold:]) / total if total else 0.0


def contact_sheet(paths, out: Path, thumb_w: int = 480):
    thumbs = []
    for p in paths:
        im = Image.open(p).convert("RGB")
        h = int(im.height * thumb_w / im.width)
        thumbs.append(im.resize((thumb_w, h)))
    if not thumbs:
        return
    cols = min(4, len(thumbs))
    rows = (len(thumbs) + cols - 1) // cols
    cell_h = max(t.height for t in thumbs)
    sheet = Image.new("RGB", (cols * thumb_w + (cols + 1) * 8, rows * cell_h + (rows + 1) * 8), (40, 40, 40))
    for i, t in enumerate(thumbs):
        r, c = divmod(i, cols)
        sheet.paste(t, (8 + c * (thumb_w + 8), 8 + r * (cell_h + 8)))
    sheet.save(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("url")
    ap.add_argument("--out", default="./render-check")
    ap.add_argument("--viewports", default="1440x900,390x844")
    ap.add_argument("--wait", type=int, default=2500, help="ms to let the scene settle after load and each scroll")
    ap.add_argument("--min-content", type=float, default=0.005, help="min bright-pixel share for a non-blank canvas")
    ap.add_argument("--reduced-motion", action="store_true")
    ap.add_argument("--ignore-hosts", default="", help="comma-separated hosts whose failed requests/errors are expected (e.g. blocked in a sandbox)")
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    report = {"url": args.url, "viewports": []}
    shots = []
    failed = False

    with sync_playwright() as p:
        browser = p.chromium.launch(args=CHROMIUM_ARGS)
        for vp in args.viewports.split(","):
            w, h = (int(x) for x in vp.lower().split("x"))
            ctx = browser.new_context(
                viewport={"width": w, "height": h},
                reduced_motion="reduce" if args.reduced_motion else "no-preference",
            )
            page = ctx.new_page()
            errors, failed_requests = [], []
            ignored = [h for h in args.ignore_hosts.split(",") if h]
            skip = lambda url: any(h in (url or "") for h in ignored)
            page.on("console", lambda m: errors.append(f"{m.text} [{m.location.get('url', '')}]")
                    if m.type == "error" and not skip(m.location.get("url")) else None)
            page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
            page.on("requestfailed", lambda r: None if skip(r.url) else failed_requests.append(f"{r.url} ({r.failure})"))
            page.on("response", lambda r: failed_requests.append(f"{r.url} (HTTP {r.status})")
                    if r.status >= 400 and not skip(r.url) else None)

            page.goto(args.url, wait_until="networkidle")
            try:
                page.wait_for_selector("canvas", timeout=15000)
            except Exception:
                pass
            page.wait_for_timeout(args.wait)
            gl = page.evaluate(GL_JS)
            fps = page.evaluate(
                "() => new Promise(r => { let n = 0; const t0 = performance.now();"
                " (function f() { n++; if (performance.now() - t0 < 1500) requestAnimationFrame(f);"
                " else r(n / 1.5) })() })"
            )

            entry = {"viewport": vp, "gl": gl, "fps": round(fps, 1), "stops": []}
            for i, y in enumerate(page.evaluate(STOPS_JS)):
                page.evaluate(f"window.scrollTo(0, {y})")
                page.wait_for_timeout(args.wait)
                full = out / f"{vp}_stop{i}.png"
                page.screenshot(path=str(full))
                page.evaluate(HIDE_DOM_JS, True)
                bare = out / f"{vp}_stop{i}_canvas.png"
                page.screenshot(path=str(bare))
                page.evaluate(HIDE_DOM_JS, False)
                ratio = content_ratio(bare)
                entry["stops"].append({"scrollY": y, "screenshot": full.name, "canvas_content": round(ratio, 4)})
                shots.append(full)

            entry["errors"] = errors
            entry["failed_requests"] = failed_requests
            blank = [s for s in entry["stops"] if s["canvas_content"] < args.min_content]
            entry["ok"] = bool(gl.get("canvas")) and bool(gl.get("context")) and not gl.get("lost") and not blank and not errors and not failed_requests
            failed |= not entry["ok"]
            report["viewports"].append(entry)
            ctx.close()
        browser.close()

    contact_sheet(shots, out / "contact_sheet.png")
    (out / "report.json").write_text(json.dumps(report, indent=2))

    for v in report["viewports"]:
        status = "OK " if v["ok"] else "FAIL"
        print(f"[{status}] {v['viewport']}  webgl={v['gl'].get('context')} renderer={v['gl'].get('renderer')} fps~{v['fps']}")
        if v["fps"] < 15 and not args.reduced_motion:
            print("       note: low fps in the headless renderer; eased motion may be mid-transition in these"
                  " screenshots. Re-run with --reduced-motion to check final positions.")
        for s in v["stops"]:
            flag = "" if s["canvas_content"] >= args.min_content else "   <- BLANK CANVAS"
            print(f"       stop @ y={s['scrollY']:<6} canvas content {s['canvas_content']:.2%}{flag}")
        for e in v["errors"][:10]:
            print(f"       error: {e}")
        for r in v["failed_requests"][:10]:
            print(f"       failed request: {r}")
    print(f"\nScreenshots + contact_sheet.png in {out.resolve()}  (open the contact sheet and look at it)")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
