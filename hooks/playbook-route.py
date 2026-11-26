#!/usr/bin/env python3
"""
Puts the matching playbooks in front of the model, so they no longer depend on the model
remembering to open Playbooks/INDEX.md (it did in 3 of 18 benchmark runs).

    playbook-route.py            UserPromptSubmit: match the owner's message
    playbook-route.py --agent    PreToolUse on Agent / Task: match the brief a subagent gets
    playbook-route.py --subagent SubagentStart: hand the coding subagent the playbooks matched
                                 for its brief, or else for the session

Matching: `Playbooks/routes.json` maps each playbook to keywords (English and Arabic; Arabic
compared after normalising alef, ya, ta marbuta, tatweel and diacritics). Up to three files with
the most keyword hits. Each one is injected as an excerpt (Decision, Minimum and Standard rules,
Pitfalls) of at most 2,500 characters, with its path for the rest. A playbook already given in
this session is named, not repeated. No match, no output.

Switch: `playbooks` (on by default). Any failure exits 0 with no output.
"""
import json
import os
import re
import sys

HOOKS = os.path.dirname(os.path.abspath(__file__))
KIT = os.path.dirname(HOOKS)
sys.path.insert(0, HOOKS)
try:
    import kit_config
except Exception:
    kit_config = None

PLAYBOOKS = os.path.join(KIT, "Playbooks")
ROUTES = os.path.join(PLAYBOOKS, "routes.json")
MAX_FILES = 3
MAX_CHARS = 2500
CODING_AGENTS = {"senior-engineer", "backend-architect", "Frontend Developer", "mobile-developer", "ai-engineer",
                 "integration-engineer", "Database-Optimizer", "devops-sre", "qa-tester", "security-reviewer",
                 "code-reviewer", "cto", "general-purpose"}
DIACRITICS = re.compile(r"[ً-ْـ]")
ARABIC = re.compile(r"[؀-ۿ]")
KEEP_SECTIONS = ("Minimum", "Standard")


def normalise(text):
    text = DIACRITICS.sub("", str(text or "").lower())
    for a, b in (("أ", "ا"), ("إ", "ا"), ("آ", "ا"), ("ى", "ي"), ("ة", "ه"), ("ؤ", "و"), ("ئ", "ي")):
        text = text.replace(a, b)
    return text


def load_routes():
    with open(ROUTES, encoding="utf-8") as fh:
        data = json.load(fh)
    return {k: [normalise(w) for w in v] for k, v in data.items() if not k.startswith("_")}


AR = "\u0600-\u06FF"
AR_PREFIX = "(?:و|ف|ب|ك|ل)?(?:ال)?"
AR_SUFFIX = "(?:ه|ها|هم|ات|ين|ون|ي|ك|كم|نا)?"


def hits(text, keyword):
    if ARABIC.search(keyword):
        pattern = f"(?<![{AR}]){AR_PREFIX}{re.escape(keyword)}{AR_SUFFIX}(?![{AR}])"
    else:
        pattern = r"(?<![a-z0-9])" + re.escape(keyword) + r"(?![a-z0-9])"
    return len(re.findall(pattern, text))


FENCED = re.compile(r"```.*?```", re.S)


def match(text, routes):
    text = normalise(FENCED.sub(" ", str(text or "")))
    scored = []
    for path, words in routes.items():
        score = sum(1 for w in words if w and hits(text, w))
        if score:
            scored.append((score, path))
    scored.sort(key=lambda s: (-s[0], s[1]))
    return [p for _, p in scored[:MAX_FILES]]


def excerpt(rel):
    with open(os.path.join(PLAYBOOKS, *rel.split("/")), encoding="utf-8") as fh:
        text = fh.read()
    title = next((l[2:].strip() for l in text.splitlines() if l.startswith("# ")), rel)
    decision = re.search(r"^- \*\*Decision:\*\*.*$", text, re.M)
    parts = [f"### {title} (`Playbooks/{rel}`)"]
    if decision:
        parts.append(decision.group(0))
    for level in KEEP_SECTIONS:
        m = re.search(r"^### " + level + r"\b.*?$(.*?)(?=^### |^## )", text, re.M | re.S)
        if m and m.group(1).strip():
            parts.append(f"{level}:" + "\n" + m.group(1).strip())
    m = re.search(r"^## Pitfalls\s*$(.*?)(?=^## |\Z)", text, re.M | re.S)
    if m and m.group(1).strip():
        parts.append("Pitfalls:\n" + m.group(1).strip())
    body = "\n\n".join(parts)
    if len(body) > MAX_CHARS:
        body = body[:MAX_CHARS].rsplit("\n", 1)[0] + "\n…"
    return body + f"\n(Edge cases and Verify: read `Playbooks/{rel}`.)"


def state_path(session_id, name):
    safe = "".join(c for c in str(session_id or "") if c.isalnum() or c in "-_")[:64]
    if not safe or not kit_config:
        return None
    return os.path.join(kit_config.home(), kit_config.STORAGE_DIR, "state", f"playbooks-{name}-{safe}.json")


def read_state(path):
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, list) else []
    except Exception:
        return []


def write_state(path, items):
    if not path:
        return
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(items[-20:], fh)
    except OSError:
        pass


def render(files, seen, header):
    fresh = [f for f in files if f not in seen]
    again = [f for f in files if f in seen]
    if not fresh and not again:
        return ""
    lines = [header]
    for rel in fresh:
        try:
            lines.append(excerpt(rel))
        except OSError:
            continue
    if again:
        lines.append("Still applies, given earlier this session: " + " · ".join(f"`Playbooks/{r}`" for r in again))
    lines.append("The project's own code and the owner's profile win over a playbook. Pick the project's level "
                 "(Playbooks/INDEX.md) and do not apply a higher level to be safe.")
    return "\n\n".join(lines)


def emit(event, text):
    if text:
        print(json.dumps({"hookSpecificOutput": {"hookEventName": event, "additionalContext": text}},
                         ensure_ascii=False))


def main():
    try:
        payload = json.load(sys.stdin)
        if not isinstance(payload, dict):
            return 0
    except Exception:
        return 0
    try:
        if kit_config and not kit_config.gate("playbooks", payload):
            return 0
        routes = load_routes()
        args = sys.argv[1:]
        session = payload.get("session_id")
        given = state_path(session, "given")
        if "--agent" in args:
            ti = payload.get("tool_input") or {}
            files = match(str(ti.get("prompt") or "") + " " + str(ti.get("description") or ""), routes)
            write_state(state_path(session, "brief"), files)
            return 0
        if "--subagent" in args:
            agent = str(payload.get("agent_type") or "").split(":")[-1]
            if agent not in CODING_AGENTS:
                return 0
            files = read_state(state_path(session, "brief")) or read_state(given)
            emit("SubagentStart", render(files[:MAX_FILES], set(),
                                         "[playbooks] The kit's playbooks for this brief. Apply them:"))
            return 0
        files = match(payload.get("prompt"), routes)
        seen = set(read_state(given))
        text = render(files, seen, "[playbooks] This request matches the kit's playbooks. Apply them, and say "
                                   "which ones you used in the report:")
        write_state(given, list(dict.fromkeys(list(seen) + files)))
        emit("UserPromptSubmit", text)
    except Exception:
        return 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
