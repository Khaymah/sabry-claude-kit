#!/usr/bin/env python3
"""
Stop hook: one closing note instead of several.

Runs the kit's three end-of-turn reminders with the same payload and merges whatever
they return into a single additionalContext:

    verify-reminder.py        code changed and no check ran after the last edit
    kit_plans.py --stop       an active plan was not updated after the work
    team-review-reminder.py   enough code changed this session to deserve a review

Each one keeps its own switch, its own once-per-change memory and its own tests; this
file only decides how they reach the model. Separately, each could be answered with its
own short message after the real report. Merged, the model is told to answer all of
them in one short addition and not to restate the report.

Quiet when none of them has anything to say. Exit 0 on any failure.
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REMINDERS = (("verify-reminder.py",), ("kit_plans.py", "--stop"), ("team-review-reminder.py",))
CLOSING = ("\n\nAnswer the points above in ONE short addition to your reply: do what can be done now "
           "(run the check, tick the boxes), state the rest in a line each. Do not repeat the report "
           "you already gave; it stays the main message.")


def run(parts, raw):
    try:
        p = subprocess.run([sys.executable, os.path.join(HERE, parts[0])] + list(parts[1:]),
                           input=raw, capture_output=True, text=True, timeout=25)
        out = json.loads(p.stdout) if p.stdout.strip() else {}
        return str((out.get("hookSpecificOutput") or {}).get("additionalContext") or "").strip()
    except Exception:
        return ""


def main():
    raw = sys.stdin.read() if not sys.stdin.isatty() else ""
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except Exception:
        return 0
    if not isinstance(payload, dict) or payload.get("stop_hook_active"):
        return 0
    notes = [n for n in (run(parts, raw) for parts in REMINDERS) if n]
    if not notes:
        return 0
    text = notes[0] if len(notes) == 1 else "\n\n".join(notes) + CLOSING
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "Stop", "additionalContext": text}},
                     ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        sys.exit(0)
