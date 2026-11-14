#!/usr/bin/env python3
"""
Lessons: a correction the owner makes once is not repeated in a later session.

A lesson is one line in <project>/.agents/memory/lessons.md (committed with the project):

    - [2026-11-14] when: <situation> | wrong: <what was done> | right: <what the owner wants> | files: src/**/*.ts | commands: git push

`files` (globs) and `commands` (text, or `re:<regex>`) say where it applies; a lesson
with neither is general. Owner-wide lessons live in ~/.agents/lessons.md and travel in
the `sabry-profile` skill (`kit_profile.py bundle`).

Modes:
    lessons.py --prompt [--all]   UserPromptSubmit hook. First prompt of a session: shows the
                                  general lessons (--all: scoped ones too, for tools whose
                                  PreToolUse cannot add context). A prompt that reads like a
                                  correction: asks the agent to record a lesson.
    lessons.py --start            SessionStart hook (Claude Code). Shows the general lessons at
                                  once. After a compaction or /clear the earlier reminders are
                                  gone from the context, so it forgets what it already showed:
                                  general lessons come back now, scoped ones on the next match.
    lessons.py --match            PreToolUse hook (Bash, Write, Edit, MultiEdit). Shows the
                                  lessons whose pattern matches the file or command, once
                                  per lesson per session.
    lessons.py add --when .. --wrong .. --right .. [--files ..] [--commands ..] [--global]
    lessons.py list [--json]
    lessons.py prune [--days N]   Archives lessons not matched in N days (default 180).

A lesson recorded in two projects is copied to the owner-wide file. More than MAX_LESSONS
in one file moves the least recently matched into lessons-archive.md beside it.

Switch: `"lessons": false` or SABRY_KIT_LESSONS=0. Hook modes exit 0 on any failure.
"""
import argparse
import datetime
import difflib
import hashlib
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    import kit_config
except Exception:
    kit_config = None

MAX_LESSONS = 40
MAX_SHOWN = 10
MAX_FIELD = 280
FIELDS = ("when", "wrong", "right", "files", "commands")
LINE = re.compile(r"^- \[(\d{4}-\d{2}-\d{2})\]\s+(.*)$")
HEADER = ("# Lessons\n\n"
          "Corrections the owner made, one per line, so they are not repeated. "
          "Written by sabry-kit (`lessons.py add`); editing by hand is fine, keep the line format.\n\n")
CORRECTION = re.compile(
    r"غلط|قلتلك|قلت\s*لك|ما\s*قلتش|مش\s*كد[هاة]|مش\s*ده\s*ال|مش\s*المطلوب|مر[ةه]\s*تاني[ةه]|كل\s*مر[ةه]|"
    r"كام\s*مر[ةه]|ليه\s*عملت|ما\s*تعملش|ماتعملش|متعملش|يا\s*غبي|برض[هو]\s|"
    r"\bwrong\b|\bi\s+(already\s+)?told\s+you\b|\bnot\s+what\s+i\s+(asked|said|wanted|meant)\b|"
    r"\bi\s+said\b|\bstop\s+doing\b|\bdon'?t\s+do\s+that\b|\bagain\s*[?!]|\bthat'?s\s+not\b|\bnever\s+do\b",
    re.I)
EDIT_TOOLS = ("Write", "Edit", "MultiEdit", "NotebookEdit")


def home():
    return os.path.expanduser("~")


def state_dir():
    return os.path.join(home(), ".agents", "state")


def project_file(root):
    return os.path.join(root, ".agents", "memory", "lessons.md") if root else None


def global_file():
    return os.path.join(home(), ".agents", "lessons.md")


def synced_global_file():
    d = kit_config.profile_skill_dir() if kit_config else None
    p = os.path.join(d, "lessons.md") if d else None
    return p if p and os.path.isfile(p) else None


def clean(value):
    text = re.sub(r"\s+", " ", str(value or "")).replace("|", "/").strip()
    return text[:MAX_FIELD]


def lesson_id(lesson):
    basis = (lesson.get("when", "") + "\n" + lesson.get("right", "")).lower()
    return hashlib.sha1(re.sub(r"\s+", " ", basis).encode("utf-8")).hexdigest()[:8]


def parse_line(line):
    m = LINE.match(line.strip())
    if not m:
        return None
    lesson = {"date": m.group(1)}
    for part in m.group(2).split(" | "):
        key, sep, value = part.partition(":")
        key = key.strip().lower()
        if sep and key in FIELDS:
            lesson[key] = value.strip()
    if not lesson.get("right"):
        return None
    lesson["id"] = lesson_id(lesson)
    return lesson


def read_lessons(path, scope):
    if not path or not os.path.isfile(path):
        return []
    out = []
    try:
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                lesson = parse_line(line)
                if lesson:
                    lesson["scope"] = scope
                    out.append(lesson)
    except OSError:
        return []
    return out


def format_line(lesson):
    parts = [f"{k}: {lesson[k]}" for k in FIELDS if lesson.get(k)]
    return f"- [{lesson['date']}] " + " | ".join(parts)


def write_lessons(path, lessons, header=HEADER):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(header + "".join(format_line(l) + "\n" for l in lessons))


def all_lessons(root):
    seen, out = set(), []
    sources = [(project_file(root), "project"), (global_file(), "owner"), (synced_global_file(), "owner")]
    for path, scope in sources:
        for lesson in read_lessons(path, scope):
            if lesson["id"] not in seen:
                seen.add(lesson["id"])
                out.append(lesson)
    return out


def split_patterns(value):
    return [p.strip() for p in str(value or "").split(",") if p.strip()]


def glob_regex(pattern):
    out, i = "", 0
    while i < len(pattern):
        if pattern.startswith("**/", i):
            out += "(?:.*/)?"
            i += 3
        elif pattern.startswith("**", i):
            out += ".*"
            i += 2
        elif pattern[i] == "*":
            out += "[^/]*"
            i += 1
        elif pattern[i] == "?":
            out += "[^/]"
            i += 1
        else:
            out += re.escape(pattern[i])
            i += 1
    return re.compile("^" + out + "$", re.I)


def strip_dot(path):
    return path[2:] if path.startswith("./") else path


def file_matches(lesson, rel):
    rel = strip_dot(rel.replace("\\", "/"))
    base = rel.rsplit("/", 1)[-1]
    for pattern in split_patterns(lesson.get("files")):
        pattern = strip_dot(pattern.replace("\\", "/"))
        try:
            rx = glob_regex(pattern)
        except re.error:
            continue
        if rx.match(rel) or ("/" not in pattern and rx.match(base)):
            return True
    return False


def command_matches(lesson, command):
    for pattern in split_patterns(lesson.get("commands")):
        if pattern.startswith("re:"):
            try:
                if re.search(pattern[3:], command, re.I):
                    return True
            except re.error:
                continue
        elif pattern.lower() in command.lower():
            return True
    return False


def is_general(lesson):
    return not lesson.get("files") and not lesson.get("commands")


def read_json(path, default):
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, type(default)) else default
    except Exception:
        return default


def write_json(path, data):
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False)
    except OSError:
        pass


def session_path(session):
    safe = re.sub(r"[^A-Za-z0-9_-]", "", str(session or "x"))[:64]
    return os.path.join(state_dir(), f"lessons-{safe}.json")


def hits_path():
    return os.path.join(state_dir(), "lessons-hits.json")


def today():
    return datetime.date.today().isoformat()


def take_unseen(session, lessons):
    path = session_path(session)
    state = read_json(path, {})
    shown = set(state.get("shown") or [])
    fresh = [l for l in lessons if l["id"] not in shown]
    if fresh:
        state["shown"] = sorted(shown | {l["id"] for l in fresh})
        write_json(path, state)
        hits = read_json(hits_path(), {})
        hits.update({l["id"]: today() for l in fresh})
        write_json(hits_path(), hits)
    return fresh


def describe(lesson, with_scope=False):
    text = lesson["right"]
    if lesson.get("wrong"):
        text += f" (not: {lesson['wrong']})"
    if lesson.get("when"):
        text = f"{lesson['when']}: {text}"
    if with_scope:
        where = [f"files {lesson['files']}"] if lesson.get("files") else []
        where += [f"commands {lesson['commands']}"] if lesson.get("commands") else []
        if where:
            text += f" [applies to {' · '.join(where)}]"
    return "- " + text


def self_command():
    return f'"{sys.executable}" "{os.path.abspath(__file__)}"'.replace("\\", "/")


def record_request():
    return ("[lessons] This message reads like the owner correcting something you did. If it is: fix it, "
            "then record the lesson so it is not repeated, by running:\n"
            f"{self_command()} add --when \"<situation>\" --wrong \"<what you did>\" --right \"<what the owner wants>\" "
            "[--files \"glob, glob\"] [--commands \"text, text\"] [--global]\n"
            "One specific sentence per field, in English. --files / --commands scope it to where it applies "
            "(omit both for a rule that always applies); --global for an owner preference that holds in every "
            "project. Never put a secret in a lesson. Skip this when the message is not a correction, or when "
            "an equivalent lesson already exists.")


def emit(event, text):
    print(json.dumps({"hookSpecificOutput": {"hookEventName": event, "additionalContext": text}},
                     ensure_ascii=False))


def gate(payload):
    root = kit_config.project_root(payload.get("cwd")) if kit_config else (payload.get("cwd") or os.getcwd())
    if kit_config and not kit_config.enabled("lessons", root):
        return False, root
    return True, root


FORGET_ON = ("compact", "clear")


def greeting(session, root, show_all):
    marker = session_path(session)
    state = read_json(marker, {})
    if state.get("greeted"):
        return ""
    state["greeted"] = True
    write_json(marker, state)
    lessons = all_lessons(root)
    wanted = [l for l in lessons if show_all or is_general(l)]
    fresh = take_unseen(session, wanted[-MAX_SHOWN:])
    if not fresh:
        return ""
    scoped = 0 if show_all else sum(1 for l in lessons if not is_general(l))
    tail = (f"\n{scoped} more apply to specific files or commands and appear when you touch them."
            if scoped else "")
    return ("[lessons] Corrections the owner already made. Follow them without being told again:\n"
            + "\n".join(describe(l, with_scope=show_all) for l in fresh) + tail)


def hook_start(payload):
    ok, root = gate(payload)
    if not ok:
        return
    session = payload.get("session_id")
    if payload.get("source") in FORGET_ON:
        write_json(session_path(session), {})
    text = greeting(session, root, False)
    if text:
        emit("SessionStart", text)


def hook_prompt(payload, show_all):
    ok, root = gate(payload)
    if not ok:
        return
    blocks = []
    text = greeting(payload.get("session_id"), root, show_all)
    if text:
        blocks.append(text)
    prompt = str(payload.get("prompt") or "")
    if prompt and len(prompt) <= 1500 and not prompt.lstrip().startswith("/") and CORRECTION.search(prompt):
        blocks.append(record_request())
    if blocks:
        emit("UserPromptSubmit", "\n\n".join(blocks))


def hook_match(payload):
    ok, root = gate(payload)
    if not ok:
        return
    tool, inp = payload.get("tool_name"), payload.get("tool_input") or {}
    lessons = [l for l in all_lessons(root) if not is_general(l)]
    if not lessons:
        return
    hits = []
    if tool == "Bash":
        command = str(inp.get("command") or "")
        hits = [l for l in lessons if command and command_matches(l, command)]
    elif tool in EDIT_TOOLS:
        path = str(inp.get("file_path") or inp.get("notebook_path") or "")
        if path:
            rel = os.path.relpath(path, root) if root and os.path.isabs(path) else path
            hits = [l for l in lessons if file_matches(l, rel)]
    fresh = take_unseen(payload.get("session_id"), hits[:MAX_SHOWN])
    if fresh:
        emit("PreToolUse", "[lessons] The owner corrected this before. Apply it to this action:\n"
             + "\n".join(describe(l) for l in fresh))


def similar(a, b):
    if a["id"] == b["id"]:
        return True
    norm = lambda l: re.sub(r"\s+", " ", l.get("right", "").lower()).strip()
    return difflib.SequenceMatcher(None, norm(a), norm(b)).ratio() >= 0.8


def archive_overflow(path, lessons):
    if len(lessons) <= MAX_LESSONS:
        return lessons, 0
    hits = read_json(hits_path(), {})
    ranked = sorted(lessons, key=lambda l: max(hits.get(l["id"], ""), l["date"]))
    drop = {l["id"] for l in ranked[:len(lessons) - MAX_LESSONS]}
    append_archive(path, [l for l in lessons if l["id"] in drop])
    return [l for l in lessons if l["id"] not in drop], len(drop)


def append_archive(path, lessons):
    if not lessons:
        return
    archive = os.path.join(os.path.dirname(path), "lessons-archive.md")
    new = not os.path.isfile(archive)
    with open(archive, "a", encoding="utf-8") as fh:
        if new:
            fh.write("# Lessons archive\n\nLessons no longer shown. Move a line back to lessons.md to revive it.\n\n")
        fh.write("".join(format_line(l) + "\n" for l in lessons))


def store(path, lesson):
    lessons = read_lessons(path, "")
    if any(similar(lesson, l) for l in lessons):
        return False, 0
    lessons.append(lesson)
    lessons, archived = archive_overflow(path, lessons)
    write_lessons(path, lessons)
    return True, archived


def index_path():
    return os.path.join(state_dir(), "lessons-index.json")


def seen_in_another_project(lesson, root):
    index = read_json(index_path(), {})
    key = os.path.normcase(os.path.abspath(root)) if root else ""
    elsewhere = any(similar(lesson, entry) and entry.get("project") != key for entry in index.values())
    index[lesson["id"] + ":" + hashlib.sha1(key.encode()).hexdigest()[:6]] = {
        "id": lesson["id"], "right": lesson["right"], "project": key}
    write_json(index_path(), index)
    return elsewhere


def cmd_add(args):
    root = kit_config.project_root(args.cwd) if kit_config else (args.cwd or os.getcwd())
    lesson = {"date": today()}
    for key in FIELDS:
        value = clean(getattr(args, key))
        if value:
            lesson[key] = value
    if not lesson.get("right"):
        print("lessons: --right is required", file=sys.stderr)
        return 2
    lesson["id"] = lesson_id(lesson)
    notes = []
    if root and not args.owner_wide:
        added, archived = store(project_file(root), lesson)
        notes.append(("recorded in " if added else "already in ") + os.path.relpath(project_file(root), root))
        if archived:
            notes.append(f"{archived} old lesson(s) archived")
    promote = args.owner_wide or not root or seen_in_another_project(lesson, root)
    if promote:
        added, _ = store(global_file(), lesson)
        notes.append(("recorded for every project in " if added else "already in ") + global_file().replace("\\", "/"))
        if added:
            notes.append("to carry it to other machines and cloud sessions: kit_profile.py bundle, then re-upload the zip")
    print("lessons: " + " · ".join(notes))
    return 0


def cmd_list(args):
    root = kit_config.project_root(args.cwd) if kit_config else (args.cwd or os.getcwd())
    lessons = all_lessons(root)
    if args.json:
        print(json.dumps(lessons, ensure_ascii=False, indent=2))
        return 0
    if not lessons:
        print("lessons: none recorded yet")
        return 0
    for lesson in lessons:
        print(f"[{lesson['scope']}] {lesson['id']} {describe(lesson, with_scope=True)[2:]}")
    return 0


def cmd_prune(args):
    root = kit_config.project_root(args.cwd) if kit_config else (args.cwd or os.getcwd())
    cutoff = (datetime.date.today() - datetime.timedelta(days=args.days)).isoformat()
    hits = read_json(hits_path(), {})
    total = 0
    for path in (project_file(root), global_file()):
        lessons = read_lessons(path, "")
        stale = [l for l in lessons if max(hits.get(l["id"], ""), l["date"]) < cutoff]
        if stale:
            append_archive(path, stale)
            gone = {l["id"] for l in stale}
            write_lessons(path, [l for l in lessons if l["id"] not in gone])
            total += len(stale)
    print(f"lessons: archived {total}")
    return 0


def run_hook(mode, show_all):
    try:
        payload = json.load(sys.stdin) if not sys.stdin.isatty() else {}
    except Exception:
        return 0
    if not isinstance(payload, dict):
        return 0
    if mode == "--prompt":
        hook_prompt(payload, show_all)
    elif mode == "--start":
        hook_start(payload)
    else:
        hook_match(payload)
    return 0


def main():
    argv = sys.argv[1:]
    if argv and argv[0] in ("--prompt", "--match", "--start"):
        try:
            return run_hook(argv[0], "--all" in argv[1:])
        except Exception:
            return 0
    parser = argparse.ArgumentParser(prog="lessons.py", description="Record and list owner corrections.")
    parser.add_argument("--cwd", default=None)
    sub = parser.add_subparsers(dest="cmd")
    add = sub.add_parser("add")
    for key in FIELDS:
        add.add_argument("--" + key, default="")
    add.add_argument("--global", dest="owner_wide", action="store_true")
    lst = sub.add_parser("list")
    lst.add_argument("--json", action="store_true")
    prune = sub.add_parser("prune")
    prune.add_argument("--days", type=int, default=180)
    args = parser.parse_args(argv)
    if args.cmd == "add":
        return cmd_add(args)
    if args.cmd == "list":
        return cmd_list(args)
    if args.cmd == "prune":
        return cmd_prune(args)
    parser.print_help()
    return 0


if __name__ == "__main__":
    sys.exit(main())
