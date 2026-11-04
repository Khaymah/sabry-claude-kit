#!/usr/bin/env python3
"""
PreToolUse hook (Read): stops whole-file reads of large text files.

A Read result is re-sent on every later turn of the session, so one unranged read of
a 1,500-line file costs its size again on each following request. Most tasks need a
function or a section, not the file.

Behaviour: a Read with no offset/limit on a text file longer than the budget
(default 800 lines) is denied with a message telling the agent to Grep for what it
needs and read that range. A Read that passes an explicit `limit` is always allowed,
so reading the whole file stays possible as a deliberate choice.

Switches: `"read_budget": false` (or SABRY_KIT_READ_BUDGET=0) turns it off;
`"read_budget_lines": 1200` in the profile's settings changes the threshold.
Images, PDFs, notebooks and unreadable paths pass through. Exit 0 on any failure.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    import kit_config
except Exception:
    kit_config = None

DEFAULT_LINES = 800
SKIP_EXT = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".pdf", ".ipynb",
            ".zip", ".gz", ".tar", ".woff", ".woff2", ".ttf", ".mp4", ".mp3", ".wav")
SCAN_CAP = 8 * 1024 * 1024


def count_lines(path, stop_after):
    n = 0
    with open(path, "rb") as fh:
        read = 0
        while True:
            chunk = fh.read(1 << 20)
            if not chunk:
                return n
            if b"\0" in chunk[:8192] and read == 0:
                return 0
            n += chunk.count(b"\n")
            read += len(chunk)
            if n > stop_after or read > SCAN_CAP:
                return n


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return 0
    if not isinstance(payload, dict):
        return 0
    ti = payload.get("tool_input") or {}
    path = ti.get("file_path")
    if not isinstance(path, str) or ti.get("limit") or ti.get("offset") or ti.get("pages"):
        return 0
    if path.lower().endswith(SKIP_EXT) or not os.path.isfile(path):
        return 0
    budget = DEFAULT_LINES
    if kit_config:
        root = kit_config.project_root(payload.get("cwd"))
        if not kit_config.enabled("read_budget", root):
            return 0
        try:
            budget = int(kit_config.load_profile(root)["settings"].get("read_budget_lines", DEFAULT_LINES))
        except (TypeError, ValueError):
            budget = DEFAULT_LINES
    try:
        lines = count_lines(path, budget)
    except OSError:
        return 0
    if lines <= budget:
        return 0
    name = os.path.basename(path)
    reason = (f"[read-budget] {name} has {lines}+ lines; a full read is re-sent on every later turn.\n"
              f"Find what you need first (Grep -n for the symbol or text in {name}), then Read with "
              "offset/limit around it (a few hundred lines at most).\n"
              "If you really need the whole file, call Read again with an explicit `limit`.")
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": reason,
    }}))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        sys.exit(0)
