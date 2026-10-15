#!/usr/bin/env python3
"""
PostToolUse hook: strict DRY for Next.js projects (Sabry, 2026-10-09).

After a Write/Edit to a .ts/.tsx/.js/.jsx file under src/, it looks for:

  1. Code: any run of WINDOW consecutive substantive lines in the written part that
     also appears elsewhere in src/ (or twice in the same file). Blank lines,
     comments, imports and bare closers (`}`, `);`, `</div>`) are skipped, and
     whitespace is collapsed, so reformatting does not hide a copy.
  2. Translations: a string written into an I18n file that already exists in
     another page's file (should move to Common) or in Common (should be reused).

It does not block the write (it has already happened): it returns
`decision: block` so the model must read the list and either extract the shared
code, or say in one line why the repetition is unavoidable.

Per-file window hashes are cached by mtime/size under the temp dir, so a scan of a
large src/ costs a few hundred ms after the first run.

Wired to: PostToolUse, matcher "Write|Edit|MultiEdit".
"""
import hashlib
import json
import os
import re
import sys
import tempfile

WINDOW = 6
MAX_REPORTS = 6
CODE_EXT = (".ts", ".tsx", ".js", ".jsx")
SKIP_DIRS = {"node_modules", ".next", "dist", "build", "coverage", ".git", ".turbo"}

TRIVIAL = re.compile(r"^(?:[\]\)\}>;,]+|</?[A-Za-z0-9.]*>|<>|</>|\)\}|\}\)|\}\);|\]\);|\)\);"
                     r"|return \(|return;|else \{|\} else \{|try \{|\} catch \{|default:|break;)$")
COMMENT = re.compile(r"^(//|/\*|\*|\*/|\{/\*)")
IMPORT = re.compile(r"^(import\b|export \{[^}]*\} from|export \* from|['\"]use (client|server)['\"])")
I18N_VALUE = re.compile(r"""^\s*['"]?[A-Za-z0-9_$]+['"]?\s*:\s*(['"`])((?:\\.|(?!\1).)*)\1""")


def nextjs_root(path):
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


def is_i18n(rel):
    return any(p.lower() == "i18n" for p in rel.split("/")[:-1])


def scannable(rel):
    name = rel.rsplit("/", 1)[-1]
    return (name.endswith(CODE_EXT) and not name.endswith(".d.ts")
            and ".test." not in name and ".spec." not in name and not is_i18n(rel))


def significant(text):
    """[(line_no, normalised)] for lines that carry logic or markup."""
    out = []
    for i, raw in enumerate(text.splitlines(), 1):
        s = " ".join(raw.split())
        if len(s) < 4 or COMMENT.match(s) or IMPORT.match(s) or TRIVIAL.match(s):
            continue
        out.append((i, s))
    return out


def windows(sig):
    """[(hash, first_line, last_line)] for every WINDOW-long run."""
    res = []
    for k in range(len(sig) - WINDOW + 1):
        chunk = sig[k:k + WINDOW]
        h = hashlib.sha1("\n".join(s for _, s in chunk).encode("utf-8")).hexdigest()[:16]
        res.append((h, chunk[0][0], chunk[-1][0]))
    return res


def read(path):
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            return f.read()
    except OSError:
        return None


def build_index(root):
    """hash -> [(rel, first, last)] for every scannable file, cached by mtime/size."""
    src = os.path.join(root, "src")
    cache_path = os.path.join(
        tempfile.gettempdir(), "claude-hooks",
        "dup-" + hashlib.sha1(root.lower().encode()).hexdigest()[:12] + ".json")
    try:
        with open(cache_path, encoding="utf-8") as f:
            cache = json.load(f)
    except (OSError, ValueError):
        cache = {}
    fresh = {}
    for d, dirs, files in os.walk(src):
        dirs[:] = [x for x in dirs if x not in SKIP_DIRS]
        for fn in files:
            full = os.path.join(d, fn)
            rel = os.path.relpath(full, root).replace("\\", "/")
            if not scannable(rel):
                continue
            try:
                st = os.stat(full)
            except OSError:
                continue
            stamp = f"{st.st_mtime_ns}:{st.st_size}"
            hit = cache.get(rel)
            if hit and hit.get("stamp") == stamp:
                fresh[rel] = hit
                continue
            text = read(full)
            if text is None:
                continue
            fresh[rel] = {"stamp": stamp, "w": windows(significant(text))}
    try:
        os.makedirs(os.path.dirname(cache_path), exist_ok=True)
        with open(cache_path, "w", encoding="utf-8") as f:
            json.dump(fresh, f)
    except OSError:
        pass
    index = {}
    for rel, entry in fresh.items():
        for h, a, b in entry["w"]:
            index.setdefault(h, []).append((rel, a, b))
    return index


def written_ranges(tool, ti, text):
    """Line ranges of the file that this tool call wrote."""
    if tool == "Write":
        return [(1, text.count("\n") + 1)]
    news = [e.get("new_string", "") for e in (ti.get("edits") or [])] if tool == "MultiEdit" \
        else [ti.get("new_string", "")]
    ranges = []
    for new in news:
        if not new.strip():
            continue
        start = 0
        while True:
            pos = text.find(new, start)
            if pos < 0:
                break
            first = text.count("\n", 0, pos) + 1
            ranges.append((first, first + new.count("\n")))
            if not ti.get("replace_all"):
                break
            start = pos + len(new)
    return ranges


def code_duplicates(root, rel, text, ranges):
    index = build_index(root)
    mine = windows(significant(text))
    found = {}
    for h, a, b in mine:
        if not any(a <= r_b and b >= r_a for r_a, r_b in ranges):
            continue
        for other_rel, oa, ob in index.get(h, []):
            if other_rel == rel and not (ob < a or oa > b) :
                continue  # the same window, or one overlapping it
            key = (other_rel, a)
            if key not in found:
                found[key] = (a, b, other_rel, oa, ob)
    # merge consecutive windows that match the same file into one range
    merged = []
    for a, b, orel, oa, ob in sorted(found.values(), key=lambda x: (x[2], x[0])):
        if merged and merged[-1][2] == orel and a <= merged[-1][1] + 1:
            m = merged[-1]
            merged[-1] = (m[0], max(m[1], b), orel, m[3], max(m[4], ob))
        else:
            merged.append((a, b, orel, oa, ob))
    return merged


def i18n_duplicates(root, path, rel, ti, tool):
    parts = rel.split("/")
    try:
        i18n_at = max(i for i, p in enumerate(parts[:-1]) if p.lower() == "i18n")
    except ValueError:
        return []
    i18n_root = os.path.join(root, *parts[:i18n_at + 1])
    lang_file = parts[-1]
    news = [e.get("new_string", "") for e in (ti.get("edits") or [])] if tool == "MultiEdit" \
        else [ti.get("content", "") if tool == "Write" else ti.get("new_string", "")]
    values = set()
    for new in news:
        for line in new.splitlines():
            m = I18N_VALUE.match(line)
            if m and len(m.group(2).strip()) >= 3 and re.search(r"\w", m.group(2)):
                values.add(m.group(2))
    if not values:
        return []
    hits = []
    for d, dirs, files in os.walk(i18n_root):
        dirs[:] = [x for x in dirs if x not in SKIP_DIRS]
        if lang_file not in files:
            continue
        other = os.path.join(d, lang_file)
        if os.path.normcase(other) == os.path.normcase(path):
            continue
        text = read(other) or ""
        orel = os.path.relpath(other, root).replace("\\", "/")
        common = os.path.basename(d).lower() == "common"
        for n, line in enumerate(text.splitlines(), 1):
            m = I18N_VALUE.match(line)
            if m and m.group(2) in values:
                hits.append((m.group(2), orel, n, common))
    return hits


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
    rel = os.path.relpath(path, root).replace("\\", "/")
    if not rel.startswith("src/") or not rel.endswith(CODE_EXT):
        return

    lines = []
    if is_i18n(rel):
        for value, orel, n, common in i18n_duplicates(root, path, rel, ti, tool)[:MAX_REPORTS]:
            where = f"{orel}:{n}"
            lines.append(f"- '{value}' already exists in {where}: "
                         + ("reuse that Common key instead of a new one." if common
                            else "move it to Common and point both pages at it."))
    elif scannable(rel):
        text = read(path)
        if text is None:
            return
        ranges = written_ranges(tool, ti, text)
        if not ranges:
            return
        for a, b, orel, oa, ob in code_duplicates(root, rel, text, ranges)[:MAX_REPORTS]:
            same = " (same file)" if orel == rel else ""
            lines.append(f"- {rel}:{a}-{b} repeats {orel}:{oa}-{ob}{same}")

    if not lines:
        return
    kind = "translation strings" if is_i18n(rel) else f"{WINDOW}+ line blocks"
    reason = (f"DRY check (Sabry's strict DRY rule): duplicated {kind} in what you just wrote.\n"
              + "\n".join(lines)
              + "\nExtract the shared part (a hook in _hooks.ts or a shared Use* hook, a helper, "
                "a component, or a Common translation key) and use it from both places. "
                "If the repetition is genuinely unavoidable (framework boilerplate, generated "
                "code), say why in one line and continue.")
    print(json.dumps({"decision": "block", "reason": reason}))


if __name__ == "__main__":
    main()
