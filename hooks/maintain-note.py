#!/usr/bin/env python3
"""
SessionStart hook - once per day, inject a short awareness note telling Sabry that
sabry-kit self-maintains weekly via a cloud Routine that opens a PR for review.

It does NOT run the maintenance itself: a local hook runs inside whatever project is
open (not the kit repo), and `git push` is denied by Sabry's settings, so a hook cannot
reliably open a cross-repo PR. The real engine is the weekly cloud Routine; this hook
only keeps Sabry aware when he opens a session.

Deduped to at most once per day via a stamp file. Never breaks a session: any failure
exits 0 with no output. Opt out with SABRY_KIT_NO_MAINTAIN_NOTE=1.
"""
import datetime
import json
import os
import sys


def main():
    try:
        if os.environ.get("SABRY_KIT_NO_MAINTAIN_NOTE") == "1":
            return 0
        cfg = os.environ.get("CLAUDE_CONFIG_DIR") or os.path.join(
            os.path.expanduser("~"), ".claude"
        )
        today = datetime.date.today().isoformat()
        stamp = os.path.join(cfg, ".sabry-kit-maintain-note")

        # Already noted today -> stay silent.
        try:
            with open(stamp, "r", encoding="utf-8") as fh:
                if fh.read().strip() == today:
                    return 0
        except Exception:
            pass

        # Record today's date first; if we cannot, stay silent rather than repeat
        # the note on every session of the day.
        try:
            os.makedirs(cfg, exist_ok=True)
            with open(stamp, "w", encoding="utf-8") as fh:
                fh.write(today)
        except Exception:
            return 0

        note = (
            "# sabry-kit · صيانة ذاتية\n\n"
            "عدّة sabry-kit بتحدّث نفسها **أسبوعياً** عبر Routine كلاود بيشغّل "
            "`/sabry-kit:self-maintain` وبيفتح **PR للمراجعة** على ريبو `sabry-claude-kit` "
            "(مابيدمجش تلقائياً أبداً). لو في PR صيانة مفتوح، راجعه عشان تفضل على أحدث best practices.\n\n"
            "لتشغيلها يدوياً الآن: `/sabry-kit:self-maintain`."
        )
        print(json.dumps({
            "hookSpecificOutput": {
                "hookEventName": "SessionStart",
                "additionalContext": note,
            }
        }))
    except Exception:
        return 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
