#!/usr/bin/env python3
"""
Behavioural tests for enforce-nextjs-structure.py and warn-duplication.py.

Each case builds a throwaway project, feeds the hook the exact JSON Claude Code
sends, and checks what it prints. Every "denied" case has an "allowed" twin a line
away, so a hook that denies everything (or nothing) fails.

    python test_nextjs_hooks.py
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile

HOOKS = os.path.dirname(os.path.abspath(__file__))
STRUCT = os.path.join(HOOKS, "enforce-nextjs-structure.py")
DUP = os.path.join(HOOKS, "warn-duplication.py")
FAILS = []


def run(script, payload):
    p = subprocess.run([sys.executable, script], input=json.dumps(payload),
                       capture_output=True, text=True, encoding="utf-8", timeout=60)
    if p.returncode != 0:
        return f"EXIT {p.returncode}: {p.stderr.strip()[:200]}"
    return p.stdout.strip()


def expect(label, out, denied):
    got = '"deny"' in out or '"block"' in out
    ok = got == denied and not out.startswith("EXIT")
    print(f"  {'PASS' if ok else 'FAIL'} {label}" + ("" if ok else f"  -> {out[:160] or '(silent)'}"))
    if not ok:
        FAILS.append(label)
    return out


def project(next_dep=True):
    root = tempfile.mkdtemp(prefix="nxhook-")
    deps = {"next": "16.0.0", "react": "19.0.0"} if next_dep else {"express": "5.0.0"}
    with open(os.path.join(root, "package.json"), "w", encoding="utf-8") as f:
        json.dump({"name": "t", "dependencies": deps}, f)
    for d in ("src/app/login", "src/lib", "src/Components"):
        os.makedirs(os.path.join(root, d), exist_ok=True)
    return root


def write(root, rel, text):
    full = os.path.join(root, *rel.split("/"))
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "w", encoding="utf-8", newline="") as f:
        f.write(text)
    return full


def lines(n, prefix="const Line"):
    return "".join(f"{prefix}{i} = {i};\n" for i in range(n))


def w(root, rel, content):
    return {"tool_name": "Write",
            "tool_input": {"file_path": os.path.join(root, *rel.split("/")), "content": content}}


def e(path, old, new, replace_all=False):
    return {"tool_name": "Edit",
            "tool_input": {"file_path": path, "old_string": old, "new_string": new,
                           "replace_all": replace_all}}


def test_structure():
    print("enforce-nextjs-structure")
    r = project()
    try:
        expect("600-line new file allowed", run(STRUCT, w(r, "src/Components/Big.tsx", lines(600))), False)
        expect("601-line new file denied", run(STRUCT, w(r, "src/Components/Big.tsx", lines(601))), True)
        expect("PageContent 300 allowed", run(STRUCT, w(r, "src/app/login/PageContent.tsx", lines(300))), False)
        expect("PageContent 301 denied", run(STRUCT, w(r, "src/app/login/PageContent.tsx", lines(301))), True)

        legacy = write(r, "src/lib/api.ts", lines(700))
        expect("oversized legacy file: shrinking edit allowed",
               run(STRUCT, e(legacy, "const Line1 = 1;\nconst Line2 = 2;\n", "const Line12 = 12;\n")), False)
        expect("oversized legacy file: same-size edit allowed",
               run(STRUCT, e(legacy, "const Line1 = 1;", "const Line1 = 11;")), False)
        expect("oversized legacy file: growing edit denied",
               run(STRUCT, e(legacy, "const Line1 = 1;\n", "const Line1 = 1;\nconst Extra = 0;\n")), True)
        small = write(r, "src/lib/small.ts", lines(599))
        expect("edit keeping a file at 600 allowed",
               run(STRUCT, e(small, "const Line1 = 1;\n", "const Line1 = 1;\nconst X = 0;\n")), False)
        expect("edit pushing a file to 601 denied",
               run(STRUCT, e(small, "const Line1 = 1;\n", "const Line1 = 1;\nconst X = 0;\nconst Y = 0;\n")), True)
        expect("edit with a missing old_string is left to the tool",
               run(STRUCT, e(small, "no such text", lines(900))), False)

        expect("PascalCase file allowed", run(STRUCT, w(r, "src/Components/Card.tsx", "x")), False)
        expect("camelCase file denied", run(STRUCT, w(r, "src/Components/card.tsx", "x")), True)
        expect("kebab-case file denied", run(STRUCT, w(r, "src/lib/register-form.ts", "x")), True)
        expect("dotted PascalCase (Cart.Store.ts) allowed", run(STRUCT, w(r, "src/Stores/Cart.Store.ts", "x")), False)
        expect("PascalCase test file allowed", run(STRUCT, w(r, "src/Components/Card.test.tsx", "x")), False)
        expect("framework file in a new route allowed", run(STRUCT, w(r, "src/app/register/page.tsx", "x")), False)
        expect("route group and dynamic segment allowed",
               run(STRUCT, w(r, "src/app/(public)/offers/[id]/page.tsx", "x")), False)
        expect("page helper _hooks.ts allowed", run(STRUCT, w(r, "src/app/register/_hooks.ts", "x")), False)
        expect("page helper test _utils.test.ts allowed", run(STRUCT, w(r, "src/app/register/_utils.test.ts", "x")), False)
        expect("route components/ folder allowed",
               run(STRUCT, w(r, "src/app/register/components/StepOne.tsx", "x")), False)
        expect("camelCase component inside route denied",
               run(STRUCT, w(r, "src/app/register/components/stepOne.tsx", "x")), True)
        expect("new lowercase folder outside app denied", run(STRUCT, w(r, "src/hooks/UseCart.ts", "x")), True)
        expect("new PascalCase folder outside app allowed", run(STRUCT, w(r, "src/I18n/Register/En.ts", "x")), False)
        expect(".d.ts allowed", run(STRUCT, w(r, "src/lib/env.d.ts", "x")), False)
        existing = write(r, "src/lib/legacyName.ts", "x\n")
        expect("existing lowercase file may be edited", run(STRUCT, e(existing, "x", "y")), False)
        expect("files outside src/ are not named-checked", run(STRUCT, w(r, "scripts/do-thing.ts", "x")), False)
        expect("non-code file is not size-checked", run(STRUCT, w(r, "src/Docs.md", lines(900))), False)
        expect("new file in an existing folder, same spelling, allowed",
               run(STRUCT, w(r, "src/lib/Thing.ts", "x")), False)
        expect("existing folder spelled with other case denied",
               run(STRUCT, w(r, "src/Lib/Thing.ts", "x")), True)
        expect("existing file spelled with other case denied",
               run(STRUCT, w(r, "src/lib/LegacyName.ts", "y")), True)
        expect("existing file, same spelling, may be rewritten",
               run(STRUCT, w(r, "src/lib/legacyName.ts", "y")), False)
    finally:
        shutil.rmtree(r, ignore_errors=True)

    r = project(next_dep=False)
    try:
        expect("not a Next.js project: oversized lowercase file allowed",
               run(STRUCT, w(r, "src/lib/huge-file.ts", lines(900))), False)
    finally:
        shutil.rmtree(r, ignore_errors=True)


BLOCK = """export function SumPrices(Items) {
  let Total = 0;
  for (const Item of Items) {
    if (Item.Price > 0) Total += Item.Price * Item.Qty;
  }
  const Tax = Total * 0.14;
  const Grand = Total + Tax;
  return Grand.toFixed(2);
}
"""


def test_duplication():
    print("warn-duplication")
    r = project()
    try:
        write(r, "src/lib/Prices.ts", BLOCK)
        b = write(r, "src/Components/Cart.tsx", "import x from 'y';\n" + BLOCK)
        out = expect("copied block is reported", run(DUP, w(r, "src/Components/Cart.tsx", BLOCK)), True)
        if "src/lib/Prices.ts" not in out:
            FAILS.append("report names the original file")
            print("  FAIL report names the original file")
        other = write(r, "src/Components/Other.tsx", lines(12, "const Unique"))
        expect("unique code is silent", run(DUP, w(r, "src/Components/Other.tsx", lines(12, "const Unique"))), False)

        tail = "export const Unrelated = 42;\n"
        with open(b, "a", encoding="utf-8") as f:
            f.write(tail)
        expect("edit away from an old copy is silent", run(DUP, e(b, "x", tail.strip())), False)
        with open(other, "a", encoding="utf-8") as f:
            f.write(BLOCK)
        expect("edit that pastes a copy is reported", run(DUP, e(other, "x", BLOCK)), True)

        twice = write(r, "src/Components/Twice.tsx", BLOCK + "\n// gap\n" + BLOCK.replace("SumPrices", "SumPrices2", 1))
        out = expect("same-file copy is reported", run(DUP, w(r, "src/Components/Twice.tsx", open(twice, encoding="utf-8").read())), True)
        if "same file" not in out:
            FAILS.append("same-file copy is labelled")
            print("  FAIL same-file copy is labelled")

        closers = "".join(["}\n", ");\n", "</div>\n", ")}\n", "]);\n", "return (\n"] * 4)
        write(r, "src/Components/Closers1.tsx", closers)
        write(r, "src/Components/Closers2.tsx", closers)
        expect("bare closers are not counted", run(DUP, w(r, "src/Components/Closers2.tsx", closers)), False)

        write(r, "src/Components/Cart.test.tsx", BLOCK)
        expect("test files are not checked", run(DUP, w(r, "src/Components/Cart.test.tsx", BLOCK)), False)

        write(r, "src/I18n/Common/Ar.ts", "export const Ar = {\n  save: 'حفظ',\n};\n")
        write(r, "src/I18n/Login/Ar.ts", "export const Ar = {\n  welcome: 'أهلاً بك مجدداً',\n};\n")
        reg = write(r, "src/I18n/Register/Ar.ts", "export const Ar = {\n  title: 'إنشاء حساب',\n};\n")
        out = expect("i18n value already in Common is reported",
                     run(DUP, e(reg, "  title: 'إنشاء حساب',", "  title: 'إنشاء حساب',\n  saveBtn: 'حفظ',")), True)
        if "Common" not in out:
            FAILS.append("Common hit says reuse")
            print("  FAIL Common hit says reuse")
        expect("i18n value in another page is reported",
               run(DUP, e(reg, "  title: 'إنشاء حساب',", "  title: 'إنشاء حساب',\n  back: 'أهلاً بك مجدداً',")), True)
        expect("new unique i18n value is silent",
               run(DUP, e(reg, "  title: 'إنشاء حساب',", "  title: 'إنشاء حساب',\n  hint: 'نص جديد تماماً',")), False)
        write(r, "src/I18n/Register/En.ts", "export const En = {\n  save: 'Save',\n};\n")
        expect("same value in a different language file is not a duplicate",
               run(DUP, e(os.path.join(r, "src", "I18n", "Register", "En.ts"), "x", "  hint: 'حفظ',")), False)
    finally:
        shutil.rmtree(r, ignore_errors=True)

    r = project(next_dep=False)
    try:
        write(r, "src/lib/Prices.ts", BLOCK)
        write(r, "src/lib/Copy.ts", BLOCK)
        expect("not a Next.js project: silent", run(DUP, w(r, "src/lib/Copy.ts", BLOCK)), False)
    finally:
        shutil.rmtree(r, ignore_errors=True)


if __name__ == "__main__":
    test_structure()
    test_duplication()
    print(f"\n{'ALL PASS' if not FAILS else str(len(FAILS)) + ' FAILED: ' + '; '.join(FAILS)}")
    sys.exit(1 if FAILS else 0)
