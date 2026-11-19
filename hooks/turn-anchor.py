#!/usr/bin/env python3
"""
Keeps the owner's basics in view for the whole session and catches a drift to English.

The rules are injected at session start and after a compaction. In a long session they
end up far behind English system text, tool output and reminders, and the model drifts:
it replies in English, asks in plain text, writes code without permission.

    turn-anchor.py          UserPromptSubmit: one short line with every owner message
                            (about 60 tokens) built from the profile: reply language ·
                            questions through AskUserQuestion · no code without permission ·
                            no AI attribution. Adds a correction when the last reply drifted.
    turn-anchor.py --tool   PostToolUse: silent unless the text written in this turn so far
                            drifted to English; then one correction, once per drifted text.
    turn-anchor.py --stop   Stop: when the final reply of the turn drifted, sends the model
                            back once to write it in the owner's language.

Drift: the profile language is Arabic, the recent text has at least 200 letters (code,
paths and links not counted) and under 20% of them are Arabic, and the owner's last
message did not ask for English (an email, a README, a translation, or written in English).

Switch: `turn_anchor` (on by default). Any failure exits 0 with no output.
"""
import hashlib
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit_config
import kit_profile

TAIL_BYTES = 2 * 1024 * 1024
TOOL_TAIL_BYTES = 256 * 1024
MAX_CHARS = 20000
MIN_LETTERS = 200
ARABIC_SHARE = 0.2
NOISE = re.compile(r"```.*?```|`[^`\n]*`|https?://\S+|(?<![A-Za-z0-9_.~-])(?:[A-Za-z0-9_.~-]+/)+[A-Za-z0-9_.-]*", re.S)
ARABIC = re.compile(r"[؀-ۿ]")
LATIN = re.compile(r"[A-Za-z]")
ENGLISH_WORD = r"(?:بال)?(?:إنجليزي|انجليزي|انجلش|إنجلش)"
WANTS_ENGLISH = re.compile(r"\bin english\b|\btranslat|(?:^|\s)ترجم|(?:^|\s)(?:اكتب|اكتبه|اكتبها|اكتبلي|رد|ردّ|خلي|خليه|خليها|عايزه|عايزها|ابعت|ابعته|ابعتها|حوّل|حوله)\S*\s+(?:\S+\s+){0,3}"
                           + ENGLISH_WORD, re.I)
REFUSES_ENGLISH = re.compile(r"(?:^|\s)(?:مش|بلاش|بطّ?ل|ليه|ليش|من غير|غير)\s+(?:\S+\s+){0,1}" + ENGLISH_WORD)
CONTINUED = "This session is being continued from a previous conversation"


def tail_entries(path, tail=TAIL_BYTES):
    try:
        with open(path, "rb") as fh:
            fh.seek(0, os.SEEK_END)
            size = fh.tell()
            fh.seek(max(0, size - tail))
            lines = fh.read().decode("utf-8", "replace").splitlines()
    except Exception:
        return []
    out = []
    for line in lines:
        try:
            entry = json.loads(line)
        except ValueError:
            continue
        if isinstance(entry, dict):
            out.append(entry)
    return out


def blocks(entry):
    content = (entry.get("message") or {}).get("content")
    if isinstance(content, str):
        return [{"type": "text", "text": content}]
    return [c for c in content or [] if isinstance(c, dict)]


def owner_prompt(entry):
    if entry.get("type") != "user" or entry.get("isMeta") or entry.get("isSidechain") or entry.get("isCompactSummary"):
        return None
    parts = blocks(entry)
    if any(c.get("type") == "tool_result" for c in parts):
        return None
    text = "\n".join(c.get("text", "") for c in parts if c.get("type") == "text")
    if not text.strip() or text.lstrip().startswith(("<command-", "<local-command", "<task-notification", CONTINUED)):
        return None
    return text


def turns(path, tail=TAIL_BYTES):
    """The owner's prompts and the assistant texts after each, oldest first:
    [(prompt, [(key, text), ...]), ...]. Texts before the first prompt in the tail get prompt None."""
    out = [(None, [])]
    for entry in tail_entries(path, tail):
        prompt = owner_prompt(entry)
        if prompt is not None:
            out.append((prompt, []))
            continue
        if entry.get("type") != "assistant" or entry.get("isSidechain"):
            continue
        text = "\n".join(c.get("text", "") for c in blocks(entry) if c.get("type") == "text")
        if text.strip():
            key = entry.get("uuid") or hashlib.sha1(text.encode("utf-8", "replace")).hexdigest()
            out[-1][1].append((key, text))
    return out


def letters(text):
    clean = NOISE.sub(" ", text[-MAX_CHARS:])
    return len(ARABIC.findall(clean)), len(LATIN.findall(clean))


def drifted(text):
    arabic, latin = letters(text)
    return arabic + latin >= MIN_LETTERS and arabic / (arabic + latin) < ARABIC_SHARE


def asked_english(prompt):
    if not prompt:
        return False
    if REFUSES_ENGLISH.search(prompt):
        return False
    if WANTS_ENGLISH.search(prompt):
        return True
    arabic, latin = letters(prompt)
    return latin >= 15 and arabic / (arabic + latin) < ARABIC_SHARE


def recent_window(texts):
    """The newest texts of a turn, enough of them to reach MIN_LETTERS."""
    picked, count = [], 0
    for key, text in reversed(texts):
        picked.append(text)
        arabic, latin = letters(text)
        count += arabic + latin
        if count >= MIN_LETTERS:
            break
    return "\n".join(reversed(picked))


def state_path(session_id, mode):
    safe = "".join(c for c in str(session_id or "") if c.isalnum() or c in "-_")[:64]
    if not safe:
        return None
    return os.path.join(kit_config.home(), kit_config.STORAGE_DIR, "state", f"anchor-{mode}-{safe}")


def first_time(session_id, mode, key):
    path = state_path(session_id, mode)
    if not path:
        return True
    try:
        with open(path, encoding="utf-8") as fh:
            if fh.read().strip() == key:
                return False
    except OSError:
        pass
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(key)
    except OSError:
        pass
    return True


def anchor(profile):
    lang = profile.get("language") or "ar-eg"
    parts = [f"Reply in {kit_profile.LANG.get(lang, lang)}"]
    if (profile.get("questions") or "ask") != "assume":
        parts.append("every question through AskUserQuestion")
    if (profile.get("mode") or "cto-pm") == "cto-pm":
        parts.append("no code without the owner's explicit go-ahead (\"نفّذ\" / \"implement\")")
    parts.append("no AI attribution in commits or PRs")
    return "[sabry-kit] " + " · ".join(parts) + "."


def emit(event, text):
    print(json.dumps({"hookSpecificOutput": {"hookEventName": event, "additionalContext": text}}, ensure_ascii=False))


def on_prompt(payload, profile, language):
    text = anchor(profile)
    try:
        prompt, texts = next((t for t in reversed(turns(payload.get("transcript_path") or "")) if t[1]), (None, []))
        if language.startswith("ar") and texts and not asked_english(prompt) and drifted(texts[-1][1]):
            text += ("\n[sabry-kit] Your last reply was in English. Unless the owner asks for English "
                     f"(an email, a README, a translation), write in {language_name(language)}, "
                     "headings and tables included.")
    except Exception:
        pass
    emit("UserPromptSubmit", text)


def on_tool(payload, language):
    if not language.startswith("ar"):
        return
    path = payload.get("transcript_path") or ""
    prompt, texts = turns(path, TOOL_TAIL_BYTES)[-1]
    if prompt is None:
        prompt, texts = turns(path)[-1]
    if not texts or asked_english(prompt) or not drifted(recent_window(texts)):
        return
    if first_time(payload.get("session_id"), "tool", texts[-1][0]):
        emit("PostToolUse", f"[sabry-kit] You are writing to the owner in English. Switch back now to "
                            f"{language_name(language)}: every update in this turn and the final reply.")


def on_stop(payload, language):
    if payload.get("stop_hook_active") or not language.startswith("ar"):
        return
    prompt, texts = turns(payload.get("transcript_path") or "")[-1]
    if not texts or asked_english(prompt) or not drifted(texts[-1][1]):
        return
    if first_time(payload.get("session_id"), "stop", texts[-1][0]):
        print(json.dumps({"decision": "block", "reason": (
            f"[sabry-kit] Your final reply is in English, and the owner reads {language_name(language)}. "
            "Write the same reply again in that language (technical terms may stay in English), "
            "with the same content and no apology or preamble, then stop.")}, ensure_ascii=False))


def language_name(language):
    return kit_profile.LANG.get(language, language)


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
        language = str(profile.get("language") or "ar-eg")
        args = sys.argv[1:]
        if "--tool" in args:
            on_tool(payload, language)
        elif "--stop" in args:
            on_stop(payload, language)
        else:
            on_prompt(payload, profile, language)
    except Exception:
        return 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
