#!/usr/bin/env python3
"""
UserPromptSubmit hook - keeps the owner's basics in view for the whole session.

The rules are injected at session start and after a compaction. In a long session they
end up far behind English system text, tool output and reminders, and the model drifts:
it replies in English, asks in plain text, writes code without permission. This hook adds
one short line with every owner message (about 60 tokens), built from the profile:

    reply language · questions through AskUserQuestion · no code without permission ·
    no AI attribution

It also reads the end of the transcript. When the profile language is Arabic and the last
reply was mostly English (code, paths and links not counted), it adds a direct correction.

Switch: `turn_anchor` (on by default). Any failure exits 0 with no output.
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit_config
import kit_profile

TAIL_BYTES = 2 * 1024 * 1024
MAX_CHARS = 20000
MIN_LETTERS = 200
ARABIC_SHARE = 0.2
NOISE = re.compile(r"```.*?```|`[^`\n]*`|https?://\S+|(?<![A-Za-z0-9_.~-])(?:[A-Za-z0-9_.~-]+/)+[A-Za-z0-9_.-]*", re.S)
ARABIC = re.compile(r"[؀-ۿ]")
LATIN = re.compile(r"[A-Za-z]")


def last_reply(path):
    try:
        with open(path, "rb") as fh:
            fh.seek(0, os.SEEK_END)
            size = fh.tell()
            fh.seek(max(0, size - TAIL_BYTES))
            lines = fh.read().decode("utf-8", "replace").splitlines()
    except Exception:
        return ""
    for line in reversed(lines):
        try:
            entry = json.loads(line)
        except ValueError:
            continue
        if entry.get("type") != "assistant" or entry.get("isSidechain"):
            continue
        content = (entry.get("message") or {}).get("content")
        if isinstance(content, str):
            text = content
        else:
            text = "\n".join(c.get("text", "") for c in content or [] if isinstance(c, dict) and c.get("type") == "text")
        if text.strip():
            return text
    return ""


def drifted(text):
    clean = NOISE.sub(" ", text[-MAX_CHARS:])
    arabic, latin = len(ARABIC.findall(clean)), len(LATIN.findall(clean))
    return arabic + latin >= MIN_LETTERS and arabic / (arabic + latin) < ARABIC_SHARE


def anchor(profile):
    lang = profile.get("language") or "ar-eg"
    parts = [f"Reply in {kit_profile.LANG.get(lang, lang)}"]
    if (profile.get("questions") or "ask") != "assume":
        parts.append("every question through AskUserQuestion")
    if (profile.get("mode") or "cto-pm") == "cto-pm":
        parts.append("no code without the owner's explicit go-ahead (\"نفّذ\" / \"implement\")")
    parts.append("no AI attribution in commits or PRs")
    return "[sabry-kit] " + " · ".join(parts) + "."


def main():
    try:
        payload = json.load(sys.stdin)
        if not isinstance(payload, dict):
            return 0
    except Exception:
        return 0
    try:
        if not kit_config.gate("turn_anchor", payload):
            return 0
        profile = kit_config.load_profile(kit_config.project_root(payload.get("cwd")))
        text = anchor(profile)
        lang = str(profile.get("language") or "ar-eg")
        try:
            if lang.startswith("ar") and drifted(last_reply(payload.get("transcript_path") or "")):
                text += ("\n[sabry-kit] Your last reply was in English. Unless the owner asked for English "
                         f"(an email, a README, a translation), write in {kit_profile.LANG.get(lang, lang)}, "
                         "headings and tables included.")
        except Exception:
            pass
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext": text}},
                         ensure_ascii=False))
    except Exception:
        return 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
