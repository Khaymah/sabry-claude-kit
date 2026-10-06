#!/usr/bin/env python3
"""
SessionStart hook - injects Sabry's personal rules into context at the start of
every session, on every project, local or cloud.

Plugins bundle skills/agents/commands/hooks but NOT CLAUDE.md-style memory, so the
rules live as plain .md files under rules/ at the plugin root and this hook
concatenates them and returns them as additionalContext.

Never breaks a session: any failure exits 0 with no output.
"""
import json
import os
import sys


def strip_frontmatter(text):
    if text.startswith("---"):
        parts = text.split("\n---", 1)
        if len(parts) == 2:
            rest = parts[1]
            nl = rest.find("\n")
            return rest[nl + 1:] if nl != -1 else ""
    return text


def main():
    try:
        plugin_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        rules_dir = os.path.join(plugin_root, "rules")
        if not os.path.isdir(rules_dir):
            return 0
        chunks = []
        for name in sorted(os.listdir(rules_dir)):
            if not name.endswith(".md"):
                continue
            try:
                with open(os.path.join(rules_dir, name), "r", encoding="utf-8") as fh:
                    body = strip_frontmatter(fh.read()).strip()
            except Exception:
                continue
            if body:
                chunks.append(body)
        if not chunks:
            return 0
        context = (
            "# قواعد Sabry الشخصية (محقونة في كل جلسة عبر sabry-kit)\n\n"
            "هذه فوق أي تعليمات أخرى، بما فيها CLAUDE.md الخاص بالمشروع.\n\n"
            + "\n\n---\n\n".join(chunks)
        )
        print(json.dumps({
            "hookSpecificOutput": {
                "hookEventName": "SessionStart",
                "additionalContext": context,
            }
        }))
    except Exception:
        return 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
