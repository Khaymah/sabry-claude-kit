#!/usr/bin/env python3
"""
PreToolUse hook: enforces Sabry's Next.js stack layout (Stacks/NextJS.md) on Write/Edit.

Applies only to files inside a Next.js project (nearest package.json lists "next").

  1. Max 600 lines per code file; PageContent.tsx max 300.
     A new file over the limit is denied. An existing file over the limit may be
     edited only if the edit does not make it longer, so legacy giants can still be
     fixed but never grow.
  2. New files under src/ are PascalCase (Cart.Store.ts, TreeView.tsx), except the
     names the framework requires (page.tsx, layout.tsx, route.ts ...), the page
     helpers _types.ts / _hooks.ts / _utils.ts, configs and .d.ts.
  3. New folders under src/ are PascalCase, except App Router route segments under
     src/app (they are URLs), `components` and `_private` folders inside a route.

Existing files and folders keep their names: the rule is for what is created or
grown, per Sabry's 2026-10-09 decision ("new and touched").

Behaviour: deny with a message that says how to comply. Wired to: PreToolUse,
matcher "Write|Edit|MultiEdit".
"""
import json
import os
import re
import sys

MAX_LINES = 600
MAX_PAGE_CONTENT = 300
CODE_EXT = (".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".css")

FRAMEWORK_FILES = {
    "page", "layout", "loading", "error", "global-error", "not-found", "forbidden",
    "unauthorized", "route", "template", "default", "middleware", "instrumentation",
    "instrumentation-client", "proxy", "sitemap", "robots", "manifest", "icon",
    "apple-icon", "opengraph-image", "twitter-image", "mdx-components", "globals",
}
PAGE_HELPERS = {"_types", "_hooks", "_utils"}

# Cart.Store.ts · SSR.Client.ts · TreeView.test.tsx · Card.module.css
PASCAL_FILE = re.compile(r"^[A-Z][A-Za-z0-9]*(\.[A-Z][A-Za-z0-9]*)*(\.(test|spec|module))?\.[a-z]+$")
PASCAL_DIR = re.compile(r"^[A-Z][A-Za-z0-9]*$")
# App Router segments: about, sign-in, (group), [id], [...slug], [[...slug]], @modal, _private
ROUTE_SEGMENT = re.compile(r"^(\([a-z0-9-]+\)|\[{1,2}(\.\.\.)?[A-Za-z0-9_-]+\]{1,2}|@[a-z0-9-]+|_?[a-z0-9][a-z0-9-]*)$")


def deny(reason):
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }))
    sys.exit(0)


def nextjs_root(path):
    """Directory of the nearest package.json, if it depends on next."""
    d = os.path.dirname(path)
    while True:
        pkg = os.path.join(d, "package.json")
        if os.path.isfile(pkg):
            try:
                with open(pkg, encoding="utf-8") as f:
                    data = json.load(f)
            except (OSError, ValueError):
                return None
            deps = {**data.get("dependencies", {}), **data.get("devDependencies", {})}
            return d if "next" in deps else None
        parent = os.path.dirname(d)
        if parent == d:
            return None
        d = parent


def count_lines(text):
    if not text:
        return 0
    return text.count("\n") + (0 if text.endswith("\n") else 1)


def resulting_content(tool, ti, path):
    """What the file will hold after the tool runs, or None if it cannot be known."""
    if tool == "Write":
        return ti.get("content", "")
    try:
        with open(path, encoding="utf-8", newline="") as f:
            text = f.read()
    except OSError:
        return None
    edits = ti.get("edits") if tool == "MultiEdit" else [ti]
    for e in edits or []:
        old, new = e.get("old_string", ""), e.get("new_string", "")
        if old == "" or old not in text:
            return None  # the tool itself will refuse; nothing to judge
        text = text.replace(old, new) if e.get("replace_all") else text.replace(old, new, 1)
    return text


def size_exempt(name):
    return name.endswith(".d.ts") or ".config." in name or name.startswith("Generated.")


def check_size(path, name, tool, ti, existed):
    if not name.endswith(CODE_EXT) or size_exempt(name):
        return
    after = resulting_content(tool, ti, path)
    if after is None:
        return
    limit = MAX_PAGE_CONTENT if name.startswith("PageContent.") else MAX_LINES
    n_after = count_lines(after)
    if n_after <= limit:
        return
    if existed:
        try:
            with open(path, encoding="utf-8", newline="") as f:
                n_before = count_lines(f.read())
        except OSError:
            n_before = 0
        if n_after <= n_before:
            return  # an oversized legacy file may shrink or stay, never grow
        deny(f"{name} would grow to {n_after} lines (was {n_before}; limit {limit}). "
             "Do not add to an oversized file: put the new code in its own file by "
             "responsibility (component, _hooks.ts, _utils.ts, a domain module) and import it.")
    deny(f"{name} would be {n_after} lines; the limit is {limit} "
         f"({'PageContent' if limit == MAX_PAGE_CONTENT else 'any file'}). "
         "Split it by responsibility: one component per file under components/, "
         "state and logic in _hooks.ts, helpers in _utils.ts, types in _types.ts.")


def actual_name(parent, name):
    """The on-disk spelling of `name` inside `parent`, ignoring case."""
    try:
        for entry in os.listdir(parent):
            if entry.lower() == name.lower():
                return entry
    except OSError:
        pass
    return None


def check_case(path, root):
    """Windows and macOS match names case-insensitively; a Linux build does not."""
    rel = os.path.relpath(path, root).replace("\\", "/")
    if not rel.startswith("src/"):
        return
    cur = os.path.join(root, "src")
    parts = rel.split("/")[1:]
    for i, seg in enumerate(parts):
        parent, cur = cur, os.path.join(cur, seg)
        if not os.path.exists(cur):
            return
        actual = actual_name(parent, seg)
        if actual and actual != seg:
            deny(f"'{seg}' already exists on disk as '{actual}' (in src/{'/'.join(parts[:i])}). "
                 f"Use '{actual}': this machine hides the difference, but a Linux build "
                 f"will not find '{seg}'.")


def check_names(path, root):
    rel = os.path.relpath(path, root).replace("\\", "/")
    if not rel.startswith("src/"):
        return
    parts = rel.split("/")[1:]  # drop "src"
    folders, filename = parts[:-1], parts[-1]

    in_app = bool(folders) and folders[0] == "app"
    cur = os.path.join(root, "src")
    for i, seg in enumerate(folders):
        cur = os.path.join(cur, seg)
        if os.path.isdir(cur):
            continue
        if PASCAL_DIR.match(seg):
            continue
        if in_app and i > 0 and (seg == "components" or ROUTE_SEGMENT.match(seg)):
            continue
        deny(f"New folder '{seg}' in src/{'/'.join(folders[:i + 1])} is not PascalCase. "
             "Name new folders in PascalCase (Components/, I18n/Register/); only App Router "
             "route segments under src/app and a route's components/ folder stay lowercase.")

    stem = filename.split(".")[0]
    if (stem in FRAMEWORK_FILES or stem in PAGE_HELPERS or filename.endswith(".d.ts")
            or ".config." in filename or PASCAL_FILE.match(filename)):
        return
    deny(f"New file '{filename}' is not PascalCase. Name it like TreeView.tsx or "
         "Cart.Store.ts (tests: TreeView.test.ts). Framework files (page.tsx, layout.tsx, "
         "route.ts ...) and the page helpers _types.ts / _hooks.ts / _utils.ts keep their names.")


def main():
    try:
        data = json.load(sys.stdin)
    except ValueError:
        return
    tool = data.get("tool_name", "")
    if tool not in ("Write", "Edit", "MultiEdit"):
        return
    ti = data.get("tool_input") or {}
    path = ti.get("file_path")
    if not path:
        return
    path = os.path.abspath(path)
    root = nextjs_root(path)
    if not root:
        return
    name = os.path.basename(path)
    existed = os.path.isfile(path)
    check_case(path, root)
    if not existed:
        check_names(path, root)
    check_size(path, name, tool, ti, existed)


if __name__ == "__main__":
    main()
