#!/usr/bin/env python3
"""
Puts the matching playbooks in front of the model, so they no longer depend on the model
remembering to open Playbooks/INDEX.md (it did in 3 of 18 benchmark runs).

    playbook-route.py            UserPromptSubmit: match the owner's message
    playbook-route.py --agent    PreToolUse on Agent / Task: match the brief a subagent gets
    playbook-route.py --subagent SubagentStart: hand the coding subagent the playbooks matched
                                 for its brief, or else for the session
    playbook-route.py --compact  SessionStart after a compaction: the session's latest playbooks
                                 come back in full (a compaction drops the earlier excerpts)
    playbook-route.py --stop     Stop: code was edited for a request that matched playbooks →
                                 once per change set, the model turns the playbooks' edge-case
                                 rows into tests, runs them and fixes what fails before it stops

Matching: `Playbooks/routes.json` maps each playbook to keywords (English and Arabic; Arabic
compared after normalising alef, ya, ta marbuta, tatweel and diacritics). Up to three files with
the most keyword hits. Each one is injected as an excerpt (Decision, Minimum and Standard rules,
Pitfalls) of at most 2,500 characters, with its path for the rest. A playbook already given in
this session is named, not repeated. No match, no output.

Strong models (Opus, Fable; read from the payload, `ANTHROPIC_MODEL`, the transcript, the
`--model` flag of the parent process on Linux, or `model` in settings.json) get a lean excerpt: the
Decision and the edge-case rows only, since they already follow the rules and a long rule list
pushed them to override the project's own conventions. `SABRY_KIT_PLAYBOOKS_LEAN=0|1` forces it.

Switch: `playbooks` (on by default). Any failure exits 0 with no output.
"""
import hashlib
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
CODE_EXT = (".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs", ".cs", ".php", ".java", ".kt", ".sql")
EDIT_TOOLS = ("Write", "Edit", "MultiEdit")
TAIL_BYTES = 2 * 1024 * 1024
MAX_EDGE_ROWS = 6
STRONG_MODEL = re.compile(r"opus|fable", re.I)
REQUIRED_ROW = re.compile(r"100\s*[×x]|twice|parallel|same action", re.I)


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
        pattern = r"(?<![a-z0-9])" + re.escape(keyword) + r"(?:s|es)?(?![a-z0-9])"
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


def excerpt(rel, lean=False):
    with open(os.path.join(PLAYBOOKS, *rel.split("/")), encoding="utf-8") as fh:
        text = fh.read()
    title = next((l[2:].strip() for l in text.splitlines() if l.startswith("# ")), rel)
    decision = re.search(r"^- \*\*Decision:\*\*.*$", text, re.M)
    parts = [f"### {title} (`Playbooks/{rel}`)"]
    if decision:
        parts.append(decision.group(0))
    if lean:
        rows = edge_rows(rel)
        if rows:
            parts.append("Cases to cover:\n" + "\n".join(f"- {r[:220]}" for r in rows))
        return "\n\n".join(parts) + f"\n(Rules and Verify: read `Playbooks/{rel}` only if a case is unclear.)"
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


def edge_rows(rel):
    with open(os.path.join(PLAYBOOKS, *rel.split("/")), encoding="utf-8") as fh:
        text = fh.read()
    m = re.search(r"^## Edge cases\s*$(.*?)(?=^## |\Z)", text, re.M | re.S)
    rows = []
    for line in (m.group(1) if m else "").splitlines():
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) < 2 or set(cells[0]) <= set("-: ") or cells[0].lower() == "case":
            continue
        rows.append(f"{cells[0]} → {cells[1]}")
    required = [r for r in rows if REQUIRED_ROW.search(r.split(" → ")[0])]
    return (required + [r for r in rows if r not in required])[:MAX_EDGE_ROWS]


def tail_entries(path):
    try:
        with open(path, "rb") as fh:
            fh.seek(0, os.SEEK_END)
            fh.seek(max(0, fh.tell() - TAIL_BYTES))
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


def turn_edits(path):
    """Code files edited after the owner's last message."""
    edited = []
    for entry in tail_entries(path):
        content = (entry.get("message") or {}).get("content")
        if entry.get("type") == "user" and not entry.get("isMeta") and not entry.get("isSidechain"):
            if isinstance(content, str) or not any(isinstance(c, dict) and c.get("type") == "tool_result"
                                                   for c in content or []):
                edited = []
            continue
        if entry.get("type") != "assistant" or entry.get("isSidechain"):
            continue
        for c in content or []:
            if isinstance(c, dict) and c.get("type") == "tool_use" and c.get("name") in EDIT_TOOLS:
                f = str((c.get("input") or {}).get("file_path") or "")
                if f.lower().endswith(CODE_EXT):
                    edited.append(f)
    return sorted(set(edited))


def stop_check(payload, session):
    if payload.get("stop_hook_active"):
        return ""
    files = read_state(state_path(session, "turn"))
    if not files:
        return ""
    edited = turn_edits(payload.get("transcript_path") or "")
    if not edited:
        return ""
    key = hashlib.sha1(json.dumps([files, edited]).encode()).hexdigest()
    done = state_path(session, "stopped")
    if key in read_state(done):
        return ""
    write_state(done, read_state(done) + [key])
    lines = ["[playbooks] Before you stop: the playbooks for this request list these cases. For each one this "
             "change can meet, add a test (or point to an existing one), run the tests, and fix what fails. "
             "The 100x-data and same-action-twice-or-in-parallel rows apply to almost every change."]
    for rel in files:
        try:
            rows = edge_rows(rel)
        except OSError:
            continue
        if rows:
            lines.append(f"`Playbooks/{rel}`:\n" + "\n".join(f"- {r[:220]}" for r in rows))
    lines.append("Then end with one line per case: covered by which test, or why it does not apply. No new "
                 "report; this is an addition to the one you gave.")
    return "\n\n".join(lines) if len(lines) > 2 else ""


def model_of(payload, session):
    model = payload.get("model")
    if isinstance(model, dict):
        model = model.get("id") or model.get("display_name")
    if not model:
        for entry in reversed(tail_entries(payload.get("transcript_path") or "")):
            if entry.get("type") == "assistant" and not entry.get("isSidechain"):
                model = (entry.get("message") or {}).get("model")
                if model:
                    break
    model = model or os.environ.get("ANTHROPIC_MODEL") or cli_model() or settings_model()
    saved = state_path(session, "model")
    if model:
        write_state(saved, [str(model)])
        return str(model)
    known = read_state(saved)
    return str(known[-1]) if known else ""


def cli_model():
    pid = os.getppid()
    for _ in range(4):
        try:
            with open(f"/proc/{pid}/cmdline", "rb") as fh:
                argv = fh.read().split(b"\0")
            if b"--model" in argv:
                return argv[argv.index(b"--model") + 1].decode("utf-8", "replace")
            with open(f"/proc/{pid}/stat", encoding="utf-8") as fh:
                pid = int(fh.read().rsplit(")", 1)[1].split()[1])
        except (OSError, ValueError, IndexError):
            return ""
    return ""


def settings_model():
    base = os.environ.get("CLAUDE_CONFIG_DIR") or os.path.join(os.path.expanduser("~"), ".claude")
    try:
        with open(os.path.join(base, "settings.json"), encoding="utf-8") as fh:
            return str(json.load(fh).get("model") or "")
    except Exception:
        return ""


def lean_for(payload, session):
    forced = os.environ.get("SABRY_KIT_PLAYBOOKS_LEAN")
    if forced in ("0", "1"):
        return forced == "1"
    return bool(STRONG_MODEL.search(model_of(payload, session)))


def render(files, seen, header, lean=False):
    fresh = [f for f in files if f not in seen]
    again = [f for f in files if f in seen]
    if not fresh and not again:
        return ""
    lines = [header, PRECEDENCE]
    for rel in fresh:
        try:
            lines.append(excerpt(rel, lean))
        except OSError:
            continue
    if again:
        lines.append("Still applies, given earlier this session: " + " · ".join(f"`Playbooks/{r}`" for r in again))
    lines.append("Always, whatever the playbook: every new query and endpoint filters by the tenant column when the "
                 "project has one; every input (ids, amounts, counts, dates) is validated at the edge; a read-check-write "
                 "on shared rows is one atomic statement or runs under a row lock; old rows are checked for the cases "
                 "the new rule rejects.")
    return "\n\n".join(lines)


PRECEDENCE = ("Precedence: what the owner said in this session, then the project's existing code (response shape, "
              "number types, status codes, rounding, naming), then a playbook. A playbook fills only what neither "
              "decided; never change an existing convention to match it. Pick the project's level "
              "(Playbooks/INDEX.md) and do not apply a higher level to be safe.")


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
        if "--stop" in args:
            reason = stop_check(payload, session)
            if reason:
                print(json.dumps({"decision": "block", "reason": reason}, ensure_ascii=False))
            return 0
        if "--compact" in args:
            lean = lean_for(payload, session)
            if payload.get("source") != "compact":
                return 0
            files = read_state(given)[-MAX_FILES:]
            emit("SessionStart", render(files, set(), "[playbooks] Restored after the compaction: the playbooks "
                                                      "this session was working with. Keep applying them:", lean))
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
        earlier = read_state(given)
        text = render(files, set(earlier), "[playbooks] This request matches the kit's playbooks. Apply them, and "
                                           "say which ones you used in the report:", lean_for(payload, session))
        write_state(given, [f for f in earlier if f not in files] + files)
        write_state(state_path(session, "turn"), files)
        emit("UserPromptSubmit", text)
    except Exception:
        return 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
