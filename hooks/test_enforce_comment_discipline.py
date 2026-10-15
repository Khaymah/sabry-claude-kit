# -*- coding: utf-8 -*-
"""Test suite for enforce-comment-discipline.py. Each case is a tool_input payload and
the decision expected (None = allowed, "deny" = blocked)."""
import json
import subprocess
import sys

HOOK = r"C:\Users\PC\.claude\hooks\enforce-comment-discipline.py"


def w(content, path="x.ts"):
    return {"file_path": path, "content": content}


def e(new, old="", path="x.ts"):
    return {"file_path": path, "old_string": old, "new_string": new}


def multi(edits, path="x.ts"):
    return {"file_path": path, "edits": edits}


def cases():
    return [
        ("clean code, no comment",        w("const X = 1;\nexport { X };\n"),                 None),
        ("trailing line comment",         w("const X = 1; // note\n"),                        "deny"),
        ("whole-line comment",            w("// note\nconst X = 1;\n"),                        "deny"),
        ("jsdoc block",                   w("/** does a thing */\nfunction F() {}\n"),         "deny"),
        ("plain block comment",           w("/* a note */\nconst X = 1;\n"),                   "deny"),
        ("jsdoc multiline",               w("/**\n * explains F\n * @param a x\n */\nfn();"),  "deny"),
        ("IMPORTANT line allowed",        w("// IMPORTANT: load-bearing order\nfn();\n"),      None),
        ("IMPORTANT block allowed",       w("/* IMPORTANT: do not reorder */\nfn();\n"),       None),
        ("IMPORTANT jsdoc allowed",       w("/**\n * IMPORTANT: why\n */\nfn();\n"),           None),
        ("IMPORTANT without colon denied", w("// IMPORTANT load-bearing\nfn();\n"),            "deny"),
        ("ts-expect-error directive",     w("// @ts-expect-error legacy\nfn();\n"),            None),
        ("eslint block directive",        w("/* eslint-disable no-console */\nfn();\n"),       None),
        ("triple-slash reference",        w('/// <reference types="bun" />\nfn();\n'),         None),
        ("global block directive",        w("/* global process */\nfn();\n"),                  None),
        ("url inside string, no comment", w('const U = "https://a.b//c/d";\n'),                None),
        ("slashes inside string",         w('const S = "a // b /* c */ d";\n'),                None),
        ("regex with slashes, no comment", w('const P = X.replace(/\\/+/g, "/");\n'),          None),
        ("regex then real comment",       w("const R = /a\\/b/g;\nconst y = 1; // note\n"),    "deny"),
        ("division then comment",         w("const a = b / c; // real\n"),                     "deny"),
        ("template holds slash-slash",    w("const T = `x // y ${z} /* q */`;\n"),             None),
        ("non-code md file",              w("// looks like code\ntext\n", "notes.md"),         None),
        ("non-code json file",            w('{\n  "a": 1\n}\n', "data.json"),                  None),
        ("empty content",                 w(""),                                              None),
        ("edit adds new comment",         e("const X = 1; // new\n", "const X = 1;\n"),        "deny"),
        ("edit keeps pre-existing comment",
         e("const X = 2; // legacy\n", "const X = 1; // legacy\n"),                            None),
        ("multiedit one comment",
         multi([{"old_string": "a();", "new_string": "a();"},
                {"old_string": "b();", "new_string": "b(); // oops"}]),                        "deny"),
        ("multiedit all clean",
         multi([{"old_string": "a();", "new_string": "a2();"},
                {"old_string": "b();", "new_string": "b2();"}]),                               None),
        ("write jsx comment node",        w("return <div>{/* hi */}</div>;\n", "C.tsx"),       "deny"),
    ]


def main():
    fails = 0
    for name, ti, expect in cases():
        p = subprocess.run([sys.executable, HOOK],
                           input=json.dumps({"tool_input": ti, "cwd": "."}),
                           capture_output=True, text=True, encoding="utf-8")
        out = (p.stdout or "").strip()
        got = json.loads(out)["hookSpecificOutput"]["permissionDecision"] if out else None
        ok = got == expect
        fails += not ok
        print(f"{'PASS' if ok else 'FAIL'}  {name:34s} expected={expect}  got={got}")
    print("\nfailures:", fails)
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
