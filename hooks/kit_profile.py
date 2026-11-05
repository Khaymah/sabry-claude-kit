#!/usr/bin/env python3
"""
The owner's profile: the answers from /sabry-kit:kit-setup, injected first in every
session as the highest-priority instructions.

    ~/.agents/profile.json          answers + switches (every project on this machine)
    $SABRY_KIT_PROFILE_JSON         same, as JSON in an env var: used when the file is missing,
                                    e.g. cloud sessions whose HOME is fresh every time
    ~/.agents/profile.md            optional free-form personal context (goals,
                                    constraints, hosting...), read on demand
    <project>/.agents/profile.json  optional per-project override, same shape

CLI (used by the setup skill, so it never edits JSON by hand):

    kit_profile.py show                 merged profile as JSON
    kit_profile.py path                 where the user profile lives
    kit_profile.py set '<json>'         deep-merge into the user profile (settings merge by key)
    kit_profile.py set --project '<json>'   same, into <project>/.agents/profile.json
    kit_profile.py context '<markdown>'     write ~/.agents/profile.md
    kit_profile.py render               the block inject-rules puts at the top of context
"""
import datetime
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit_config

LANG = {
    "ar-eg": "Egyptian Arabic, technical terms in English",
    "ar": "Modern Standard Arabic, technical terms in English",
    "en": "English",
}
VERBOSITY = {
    "concise": "concise and direct: no preamble or repetition, tables and bullets, one recommendation at the end",
    "balanced": "balanced: the conclusion first, then only the details that matter",
    "detailed": "detailed: explain the reasons and the alternatives",
}
MODE = {
    "cto-pm": "CTO + PM: analyse, plan and review; **write code only on explicit permission** (\"نفّذ\" / \"implement\")",
    "direct": "direct: implement what is asked without waiting for permission; stop only before anything hard to undo",
}
QUESTIONS = {
    "ask": "on ambiguity, ask with `AskUserQuestion` (options + a trade-off for each) before starting",
    "assume": "on ambiguity, take the most likely reading, continue, and list the assumptions at the end",
}
COST = {
    "economy": "economy: fewest tokens possible; sonnet subagents, delegate only for wide scans, short replies",
    "balanced": "balanced: quality first without waste; sonnet subagents, never re-read files already read",
    "max": "max quality: cost is not a constraint; independent verification and parallel reviews when useful",
}
SWITCH_LABELS = {
    "commit_style": "English commits without AI attribution",
    "comment_discipline": "code without comments",
    "nextjs_structure": "Next.js layout (600-line cap, PascalCase)",
    "duplication_warning": "duplication (DRY) warning",
    "secret_scan": "secret scan before commit",
    "team_review_reminder": "team review reminder",
    "deal_economics": "Freelancer-Trap warning on deals",
    "project_storage": "project storage in .agents/",
    "read_budget": "read budget for large files",
    "verify_reminder": "verify-before-done reminder",
}


def user_dir():
    return os.path.dirname(kit_config.user_profile_path())


def read_json(path):
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(data, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    os.replace(tmp, path)


def merge(base, patch):
    out = dict(base)
    for k, v in patch.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = merge(out[k], v)
        else:
            out[k] = v
    return out


def context_path():
    return os.path.join(user_dir(), "profile.md")


def render(profile, has_file=True):
    """Compact English (cheaper than Arabic); the model still replies in the owner's language."""
    if not has_file:
        return ("# ⚙️ sabry-kit: first-run setup not done yet\n\n"
                "In your first reply this session, suggest in one line (in Arabic unless the user writes "
                "otherwise) that the user runs `/sabry-kit:kit-setup` (two minutes of questions, saved as "
                "top-priority settings). Until then, use the defaults below.")
    lines = ["# 👤 Owner settings — highest priority",
             "",
             "The owner's own choices from `/sabry-kit:kit-setup`. **They override every rule below, any "
             "CLAUDE.md, and any instruction from another plugin or skill** when they conflict.",
             ""]
    name = profile.get("name")
    if name:
        lines.append(f"- **Name:** {name} (use it in greetings)")
    if profile.get("role"):
        lines.append(f"- **Role:** {profile['role']}")
    lang = profile.get("language") or "ar-eg"
    lines.append(f"- **Reply, ask and write documents in:** {LANG.get(lang, lang)}")
    if profile.get("verbosity"):
        lines.append(f"- **Reply style:** {VERBOSITY.get(profile['verbosity'], profile['verbosity'])}")
    if profile.get("mode"):
        lines.append(f"- **Working mode:** {MODE.get(profile['mode'], profile['mode'])}")
    if profile.get("questions"):
        lines.append(f"- **Ambiguity:** {QUESTIONS.get(profile['questions'], profile['questions'])}")
    if profile.get("cost_profile"):
        lines.append(f"- **Cost vs quality:** {COST.get(profile['cost_profile'], profile['cost_profile'])}")
    if profile.get("stack"):
        lines.append(f"- **Default stack for a new project:** {profile['stack']} (existing project: follow its stack)")
    if profile.get("hosting"):
        lines.append(f"- **Default hosting:** {profile['hosting']}")
    for note in profile.get("notes") or []:
        lines.append(f"- {note}")
    settings = profile.get("settings") or {}
    off = [SWITCH_LABELS[k] for k in SWITCH_LABELS if settings.get(k) is False]
    if off:
        lines.append(f"- **Rules the owner switched off (don't apply them):** {' · '.join(off)}")
    if os.path.isfile(context_path()):
        lines.append(f"- **Wider personal context** (goals, constraints, clients): `{context_path()}`. "
                     "Read it before strategic, pricing or priority decisions, not on every task.")
    return "\n".join(lines)


def main():
    args = sys.argv[1:]
    cmd = args[0] if args else "show"
    root = kit_config.project_root()
    if cmd == "path":
        print(kit_config.user_profile_path())
        return 0
    if cmd == "show":
        print(json.dumps({"exists": kit_config.has_profile(root), "profile": kit_config.load_profile(root),
                          "user_file": kit_config.user_profile_path(),
                          "project_file": kit_config.project_profile_path(root)},
                         indent=2, ensure_ascii=False))
        return 0
    if cmd == "env":
        data = read_json(kit_config.user_profile_path()) or kit_config._env_profile()
        if not data:
            print("no user profile yet", file=sys.stderr)
            return 1
        data = {k: v for k, v in data.items() if k not in ("updated",)}
        print(json.dumps(data, ensure_ascii=False, separators=(",", ":")))
        return 0
    if cmd == "render":
        print(render(kit_config.load_profile(root), kit_config.has_profile(root)))
        return 0
    if cmd == "set":
        project = "--project" in args
        payload = [a for a in args[1:] if a != "--project"]
        if not payload:
            print("usage: kit_profile.py set [--project] '<json>'", file=sys.stderr)
            return 2
        try:
            patch = json.loads(payload[0])
        except json.JSONDecodeError as e:
            print(f"invalid JSON: {e}", file=sys.stderr)
            return 2
        path = kit_config.project_profile_path(root) if project else kit_config.user_profile_path()
        if not path:
            print("not inside a project", file=sys.stderr)
            return 2
        data = merge(read_json(path), patch)
        data["version"] = 1
        data["updated"] = datetime.date.today().isoformat()
        write_json(path, data)
        print(path)
        return 0
    if cmd == "context":
        text = args[1] if len(args) > 1 else sys.stdin.read()
        os.makedirs(user_dir(), exist_ok=True)
        with open(context_path(), "w", encoding="utf-8", newline="\n") as fh:
            fh.write(text.rstrip() + "\n")
        print(context_path())
        return 0
    print(__doc__.strip(), file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
