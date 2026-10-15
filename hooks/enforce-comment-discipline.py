#!/usr/bin/env python3
"""
PreToolUse hook - enforces Sabry's absolute comment rule (all projects):

  Code carries NO comments. Not line comments, not block comments, not JSDoc.
  The ONLY comment allowed in source is one that opens with `IMPORTANT:` and
  marks something genuinely exceptional. Readable code is NEVER commented.

Why a hook and not just CLAUDE.md: the "keep JSDoc" habit kept creeping back in
after every cleanup, and the model's own training biases toward documenting code.
Instructions lose to instructions; a hook does not. Same reasoning as
enforce-opus.py / enforce-commit-style.py.

Always exempt (removing them breaks the build, they are functional not prose):
  ts-expect-error / ts-ignore / ts-nocheck / ts-check, triple-slash <reference>,
  eslint-*, prettier-ignore, biome-ignore, c8/v8/istanbul ignore, @jsxImportSource,
  @vite-ignore, webpackChunkName, __PURE__, @preserve, @license, /* global */.

Scope: JS/TS source only (.ts .tsx .mts .cts .js .jsx .mjs .cjs). Other file types
(Markdown, YAML, Python, shell) are left alone - this hook file itself is Python.

Behaviour: deny, naming the file and the offending comment. For Edit/MultiEdit a
comment that already exists verbatim in the old_string is NOT flagged, so touching
code next to a legacy comment is not blocked - only ADDING a comment is.

Wired to: PreToolUse, matcher "Write|Edit|MultiEdit".
"""
import json
import os
import re
import sys

CODE_EXT = (".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs")

DIRECTIVE = re.compile(
    r"^/{2,}\s*(@ts-(expect-error|ignore|nocheck|check)\b|<reference\b|eslint-|"
    r"prettier-ignore\b|biome-ignore\b|c8 ignore\b|v8 ignore\b|istanbul ignore\b|"
    r"@jsxImportSource\b|@vite-ignore\b|webpackChunkName|#?__PURE__|@preserve|@license)")
BLOCK_DIRECTIVE = re.compile(
    r"^/\*\s*(eslint-|@ts-|#?__PURE__|webpackChunkName|@vite-ignore|prettier-ignore|"
    r"biome-ignore|c8 ignore|v8 ignore|istanbul ignore|@jsxImportSource|@preserve|"
    r"@license|global\s)")

_DIV_AFTER = set(
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_$)]}`'\"/")


def _regex_allowed(prev):
    return prev == "" or prev not in _DIV_AFTER


def _consume_regex(src, i, n):
    """i is at a `/` that starts a regex. Return index past the closing `/`+flags,
    or None if it does not close on this line (then the caller treats `/` as divide)."""
    j = i + 1
    in_class = False
    while j < n:
        ch = src[j]
        if ch == "\\":
            j += 2
            continue
        if ch == "\n":
            return None
        if ch == "[":
            in_class = True
        elif ch == "]":
            in_class = False
        elif ch == "/" and not in_class:
            j += 1
            while j < n and src[j].isalpha():
                j += 1
            return j
        j += 1
    return None


def find_comments(src):
    """Yield (start, end, kind) for real JS/TS comments, skipping strings, template
    literals (with ${} interpolation) and regex literals. kind is 'line' or 'block'.
    `//` and `/*` can never begin a regex (an empty regex is invalid), so the comment
    branches correctly win over the regex branch."""
    out = []
    i, n = 0, len(src)
    prev = ""
    stack = [{"kind": "code", "interp": False, "depth": 0}]
    while i < n:
        f = stack[-1]
        c = src[i]
        if f["kind"] == "code":
            two = src[i:i + 2]
            if two == "//":
                j = src.find("\n", i)
                if j == -1:
                    j = n
                out.append((i, j, "line"))
                i = j
                continue
            if two == "/*":
                j = src.find("*/", i + 2)
                end = (j + 2) if j != -1 else n
                out.append((i, end, "block"))
                i = end
                prev = "/"
                continue
            if c in "'\"":
                q = c
                i += 1
                while i < n:
                    if src[i] == "\\":
                        i += 2
                        continue
                    if src[i] == q:
                        i += 1
                        break
                    if src[i] == "\n":
                        break
                    i += 1
                prev = q
                continue
            if c == "`":
                stack.append({"kind": "tmpl", "interp": False, "depth": 0})
                i += 1
                prev = "`"
                continue
            if c == "/":
                if _regex_allowed(prev):
                    end = _consume_regex(src, i, n)
                    if end is not None:
                        i = end
                        prev = "/"
                        continue
                prev = "/"
                i += 1
                continue
            if c in " \t\r\n":
                i += 1
                continue
            if c == "{":
                f["depth"] += 1
                prev = c
                i += 1
                continue
            if c == "}":
                if f["interp"] and f["depth"] == 0:
                    stack.pop()
                    i += 1
                    prev = "`"
                    continue
                if f["depth"] > 0:
                    f["depth"] -= 1
                prev = c
                i += 1
                continue
            prev = c
            i += 1
            continue
        else:
            if c == "\\":
                i += 2
                continue
            if c == "`":
                stack.pop()
                i += 1
                prev = "`"
                continue
            if src[i:i + 2] == "${":
                stack.append({"kind": "code", "interp": True, "depth": 0})
                i += 2
                prev = "{"
                continue
            i += 1
            continue
    return out


def _inner(kind, text):
    body = text[2:] if kind == "line" else (text[2:-2] if text.endswith("*/") else text[2:])
    return body.lstrip("*/ \t\r\n")


def is_allowed(kind, text):
    if kind == "line" and DIRECTIVE.match(text):
        return True
    if kind == "block" and BLOCK_DIRECTIVE.match(text):
        return True
    return _inner(kind, text).lower().startswith("important:")


def _is_code_file(path):
    return isinstance(path, str) and path.lower().endswith(CODE_EXT)


def deny(reason):
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        },
    }))
    return 0


def _segments(ti):
    out = []
    if isinstance(ti.get("content"), str):
        out.append((ti["content"], ""))
    if isinstance(ti.get("new_string"), str):
        out.append((ti["new_string"], ti.get("old_string") or ""))
    edits = ti.get("edits")
    if isinstance(edits, list):
        for e in edits:
            if isinstance(e, dict) and isinstance(e.get("new_string"), str):
                out.append((e["new_string"], e.get("old_string") or ""))
    return out


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return 0
    ti = payload.get("tool_input") or {}
    if not isinstance(ti, dict):
        return 0
    if not _is_code_file(ti.get("file_path")):
        return 0

    for added, old in _segments(ti):
        for start, end, kind in find_comments(added):
            text = added[start:end]
            if is_allowed(kind, text):
                continue
            stripped = text.strip()
            if stripped and stripped in old:
                continue
            snippet = " ".join(stripped.split())[:90]
            return deny(
                "[enforce-comment-discipline] Blocked: this edit adds a comment to "
                f"{os.path.basename(str(ti.get('file_path')))}.\n"
                f"Offending comment: {snippet}\n"
                "Sabry's iron rule, all projects: source code carries NO comments - "
                "no line comments, no block comments, no JSDoc. Readable code is never "
                "commented; rationale lives in ADR / Plan, not in the code.\n"
                "Allowed exceptions: build directives (ts-expect-error, eslint-disable, "
                "triple-slash reference, biome-ignore ...), and a comment that opens with "
                "`IMPORTANT:` marking something genuinely exceptional.\n"
                "Fix: delete the comment, or - only if truly exceptional - rewrite it as "
                "`// IMPORTANT: <reason>` and re-run."
            )
    return 0


if __name__ == "__main__":
    sys.exit(main())
