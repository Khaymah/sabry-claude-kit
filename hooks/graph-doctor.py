#!/usr/bin/env python3
"""
graph-doctor — يفحص تغطية code-review-graph عبر كل مشاريعك، ويبني الناقص.

المشكلة التي يحلّها: `code-review-graph build` يستنتج المستودع من **جذر git**.
في المشاريع متعددة الأجزاء هذا يفشل بصمت:
  · الجزء مستودع git مستقل        → يعمل تلقائياً ✅
  · الجزء مستبعَد في .gitignore الأب → البناء يرتدّ للجذر ويبني الملفات الخطأ ❌
      (الحل: --repo <path> صريحاً)

والنتيجة الأسوأ: graph تغطي 2% من المشروع تجيب بثقة على أسئلة لا تعرفها.

    python graph-doctor.py                 # فحص فقط
    python graph-doctor.py --build         # فحص ثم بناء الناقص
    python graph-doctor.py --root <path>   # جذر بحث مخصص
"""
import argparse
import json
import os
import subprocess
import sys

CODE_EXT = (".ts", ".tsx", ".js", ".jsx", ".vue", ".svelte", ".go", ".rs",
            ".py", ".cs", ".php", ".java", ".kt")
SKIP_DIRS = {"node_modules", ".next", ".git", "dist", "build", "bin", "obj",
             "vendor", "__pycache__", ".venv", "venv", ".code-review-graph",
             ".claude", "target", "out", "coverage"}
MIN_FILES = 25          # أصغر من ذلك لا يستحق graph
GOOD_COVERAGE = 0.60    # 60%+ يُعتبر سليماً


def count_code(path, cap=20000):
    n = 0
    for root, dirs, files in os.walk(path):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not d.startswith(".")]
        n += sum(1 for f in files if f.endswith(CODE_EXT))
        if n > cap:
            break
    return n


def sh(*args, cwd=None, timeout=20):
    try:
        return subprocess.run(args, cwd=cwd, capture_output=True,
                              text=True, timeout=timeout).stdout.strip()
    except Exception:
        return ""


def graph_files(path):
    """عدد الملفات داخل الـ graph — من قاعدة البيانات مباشرة."""
    db = os.path.join(path, ".code-review-graph", "graph.db")
    if not os.path.isfile(db):
        return None
    try:
        import sqlite3
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        for q in ("SELECT COUNT(*) FROM nodes WHERE kind='File'",
                  "SELECT COUNT(DISTINCT path) FROM nodes"):
            try:
                n = con.execute(q).fetchone()[0]
                con.close()
                return n
            except Exception:
                continue
        con.close()
    except Exception:
        pass
    return -1  # موجودة لكن تعذّرت القراءة


def own_code(path):
    """كود يخصّ هذا المجلد وحده — دون المجلدات الفرعية التي هي وحدات بذاتها."""
    n = 0
    for root, dirs, files in os.walk(path):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not d.startswith(".")]
        if root != path:
            # لا تعُدّ داخل وحدة فرعية مستقلة
            if os.path.isdir(os.path.join(root, ".git")) or \
               os.path.isdir(os.path.join(root, ".code-review-graph")):
                dirs[:] = []
                continue
        n += sum(1 for f in files if f.endswith(CODE_EXT))
        if n > 20000:
            break
    return n


def find_units(root, depth=6):
    # depth=4 كان يقطع قبل D:\Work\1-Nodejs\CRM\Est8Core\New\Server — فتُنسب ملفات
    # الوحدات المتداخلة إلى الأب، ويظهر مشروع سليم تماماً وكأن تغطيته 2%.
    """
    وحدة = حدّ مشروع حقيقي: مجلد فيه `.git` أو `.code-review-graph`.
    ما بداخل وحدة ليس وحدة (فـ Server/Src ليس مشروعاً منفصلاً عن Server).
    ويُضاف مجلد الكود الذي لا يقع داخل أي وحدة — لأنه بلا حدّ يحتاج واحداً.
    """
    bounds, plain = [], []
    for cur, dirs, _ in os.walk(root):
        if cur[len(root):].count(os.sep) >= depth:
            dirs[:] = []
            continue
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not d.startswith(".")]
        for d in list(dirs):
            p = os.path.join(cur, d)
            is_bound = os.path.isdir(os.path.join(p, ".git")) or \
                       os.path.isdir(os.path.join(p, ".code-review-graph"))
            if is_bound:
                if count_code(p) >= MIN_FILES:
                    bounds.append(p)
                # ننزل داخلها رغم ذلك: قد تحوي مستودعات متداخلة
                # (Est8Core/New يحوي Server كمستودع مستقل)
            elif count_code(p) >= MIN_FILES:
                plain.append(p)

    inside = lambda p, q: p != q and p.startswith(q + os.sep)
    keep = list(bounds)
    for p in plain:
        if any(inside(p, b) for b in bounds):
            continue                    # مغطّى بوحدة أعلى
        if any(inside(p, q) for q in plain):
            continue                    # مجلد فرعي لمرشّح آخر
        keep.append(p)

    # كل وحدة تُحسب بكودها الخاص — دون الوحدات المتفرّعة عنها.
    # بدون هذا يظهر جذر monorepo وكأن graph‑ه تغطي 2% وهو في الحقيقة سليم.
    others = set(keep)
    def own(p):
        n = 0
        for r, ds, fs in os.walk(p):
            ds[:] = [d for d in ds if d not in SKIP_DIRS and not d.startswith(".")]
            if r != p and r in others:
                ds[:] = []
                continue
            n += sum(1 for f in fs if f.endswith(CODE_EXT))
            if n > 20000:
                break
        return n

    units = []
    for p in keep:
        n = own(p)
        if n >= MIN_FILES:              # حاوية خالصة → تُسقَط
            units.append((p, n))
    return units


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=r"D:\Work")
    ap.add_argument("--build", action="store_true", help="ابنِ الناقص")
    a = ap.parse_args()

    if not os.path.isdir(a.root):
        print(f"❌ غير موجود: {a.root}")
        return 1

    print(f"🔍 مسح {a.root} ...\n")
    units = sorted(find_units(a.root), key=lambda u: -u[1])
    if not units:
        print("لا وحدات كود ذات حجم معتبر.")
        return 0

    todo = []
    print(f"{'الوحدة':<48}{'كود':>7}{'graph':>8}{'التغطية':>10}  الحالة")
    print("─" * 90)
    for path, n in units:
        g = graph_files(path)
        label = os.path.relpath(path, a.root).replace("\\", "/")
        if len(label) > 46:                 # اقطع من الرأس — الذيل هو ما يميّز الوحدة
            label = "…" + label[-45:]
        if g is None:
            print(f"{label:<48}{n:>7}{'—':>8}{'—':>10}  ❌ لا توجد graph")
            todo.append(path)
        elif g == -1:
            print(f"{label:<48}{n:>7}{'?':>8}{'?':>10}  ⚠️ تعذّرت القراءة")
        else:
            cov = g / n if n else 0
            mark = "✅ سليمة" if cov >= GOOD_COVERAGE else "❌ ناقصة"
            print(f"{label:<48}{n:>7}{g:>8}{cov*100:>9.0f}%  {mark}")
            if cov < GOOD_COVERAGE:
                todo.append(path)

    if not todo:
        print("\n✅ كل الـ graphs سليمة.")
        return 0

    print(f"\n{len(todo)} وحدة تحتاج بناءً.")
    if not a.build:
        print("أعد التشغيل بـ --build للبناء، أو يدوياً:")
        for p in todo[:5]:
            print(f'  code-review-graph build --repo "{p}"')
        return 0

    for i, p in enumerate(todo, 1):
        print(f"\n[{i}/{len(todo)}] بناء {os.path.relpath(p, a.root)} ...")
        # --repo صريح دائماً: بدونه يرتدّ لجذر git ويبني الملفات الخطأ
        r = subprocess.run(["code-review-graph", "build", "--repo", p],
                           capture_output=True, text=True)
        tail = [l for l in r.stdout.strip().splitlines() if l.strip()]
        print("   ", tail[-1] if tail else f"(exit {r.returncode})")
    print("\n✅ انتهى. أعد التشغيل بلا --build للتحقق.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
