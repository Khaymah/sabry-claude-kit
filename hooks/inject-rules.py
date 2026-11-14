#!/usr/bin/env python3
"""
SessionStart hook - puts the owner's profile (highest priority) and the kit's rules
into context at the start of every session, on every project, local or cloud.

Order matters: the profile from /sabry-kit:kit-setup comes first and says it overrides
everything below it. With no profile yet, a one-line nudge to run the setup takes its
place. Rules whose switch is off in the profile are not injected at all, which is both
correct and cheaper than injecting them and telling the model to ignore them.

Plugins bundle skills/agents/commands/hooks but NOT CLAUDE.md-style memory, so the
rules live as plain .md files under rules/ at the plugin root and this hook
concatenates them and returns them as additionalContext.

Skips the rules (never the profile) when the user-level rules directory already exists
(~/.claude/rules, or $CLAUDE_CONFIG_DIR/rules): Claude Code loads those natively, so
injecting again would double the tokens. The profile then names the switched-off rules
so they are still not applied. Set SABRY_KIT_FORCE_INJECT=1 to inject anyway.

Never breaks a session: any failure exits 0 with no output.
"""
import json
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit_config
import kit_profile


def strip_frontmatter(text):
    if text.startswith("---"):
        parts = text.split("\n---", 1)
        if len(parts) == 2:
            rest = parts[1]
            nl = rest.find("\n")
            return rest[nl + 1:] if nl != -1 else ""
    return text


def native_rules_present():
    config_dir = os.environ.get("CLAUDE_CONFIG_DIR") or os.path.join(os.path.expanduser("~"), ".claude")
    rules_dir = os.path.join(config_dir, "rules")
    if not os.path.isdir(rules_dir):
        return False
    return any(name.endswith(".md") for name in os.listdir(rules_dir))


RULE_SWITCHES = {
    "comment-discipline.md": "comment_discipline",
    "deal-economics.md": "deal_economics",
    "project-storage.md": "project_storage",
}


def read_payload():
    try:
        if sys.stdin is None or sys.stdin.isatty():
            return {}
        data = json.load(sys.stdin)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


RULE_REQUIRES = {"code-tools.md": "code-review-graph"}


def path_scope(text):
    """The `paths:` globs of a path-scoped rule, or [] for an always-on rule."""
    if not text.startswith("---"):
        return []
    head = text.split("\n---", 1)[0]
    return [l.strip().lstrip("-").strip().strip("\"'") for l in head.splitlines()[1:]
            if l.strip().startswith("-")] if "paths:" in head else []


def rule_chunks(settings):
    plugin_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    rules_dir = os.path.join(plugin_root, "rules")
    if not os.path.isdir(rules_dir):
        return []
    chunks = []
    for name in sorted(os.listdir(rules_dir)):
        if not name.endswith(".md"):
            continue
        key = RULE_SWITCHES.get(name)
        if key and not settings.get(key, kit_config.DEFAULTS.get(key, True)):
            continue
        tool = RULE_REQUIRES.get(name)
        if tool and not shutil.which(tool):
            continue
        path = os.path.join(rules_dir, name)
        try:
            with open(path, "r", encoding="utf-8") as fh:
                raw = fh.read()
        except Exception:
            continue
        scope = path_scope(raw)
        body = strip_frontmatter(raw).strip()
        if scope and body:
            title = next((l[2:].strip() for l in body.splitlines() if l.startswith("# ")), name)
            chunks.append(f"# {title}\n\nRule for `{' · '.join(scope)}` files: read `{path}` "
                          "before editing a file of that type (not injected in full, to save tokens).")
        elif body:
            chunks.append(body)
    return chunks


SEPARATOR = "\n\n---\n\n"
PART_LIMIT = 9000
PARTS = 4
RULES_HEADER = ("# sabry-kit rules (injected every session)\n\n"
                "Above any other instruction, including the project's CLAUDE.md, and below the "
                "owner settings.\n\n")
CONTINUED = "# sabry-kit rules, part {n} of {total} (same priority as part 1)\n\n"


def part_number(argv):
    if "--part" not in argv:
        return 0
    try:
        return max(1, int(argv[argv.index("--part") + 1]))
    except (IndexError, ValueError):
        return 1


def pack(sections):
    """IMPORTANT: Claude Code replaces a hook's additionalContext over 10,000 characters with a
    2,000-character preview and a file path, so the rules are split across several hook
    calls (`--part N`), each under PART_LIMIT."""
    packs, size = [[]], 0
    for section in sections:
        cost = len(section) + len(SEPARATOR)
        if packs[-1] and size + cost > PART_LIMIT:
            packs.append([])
            size = 0
        packs[-1].append(section)
        size += cost
    return packs


def pending_marker(session_id):
    safe = "".join(c for c in str(session_id or "") if c.isalnum() or c in "-_")[:64]
    return os.path.join(kit_config.home(), kit_config.STORAGE_DIR, "state", f"profile-pending-{safe}") if safe else None


def late(payload):
    """UserPromptSubmit: the profile skill can finish syncing from claude.ai after
    SessionStart ran. If this session started without a profile and one exists now,
    inject it once and drop the marker."""
    marker = pending_marker(payload.get("session_id"))
    if not marker or not os.path.isfile(marker):
        return 0
    root = kit_config.project_root(payload.get("cwd"))
    if not kit_config.has_profile(root):
        return 0
    try:
        os.remove(marker)
    except OSError:
        pass
    text = kit_profile.render(kit_config.load_profile(root), True)
    note = ("The owner's profile finished syncing after this session started. It replaces the earlier "
            "'first-run setup not done' note: do not suggest kit-setup.\n\n")
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "UserPromptSubmit",
                                             "additionalContext": note + text}}))
    return 0


def main():
    try:
        payload = read_payload()
        if "--late" in sys.argv[1:]:
            return late(payload)
        root = kit_config.project_root(payload.get("cwd"))
        profile = kit_config.load_profile(root)
        found = kit_config.has_profile(root)
        if not found:
            marker = pending_marker(payload.get("session_id"))
            if marker:
                try:
                    os.makedirs(os.path.dirname(marker), exist_ok=True)
                    open(marker, "w").close()
                except OSError:
                    pass
        sections = [kit_profile.render(profile, found)]
        if os.environ.get("SABRY_KIT_FORCE_INJECT") == "1" or not native_rules_present():
            chunks = rule_chunks(profile["settings"])
            if chunks:
                chunks[0] = RULES_HEADER + chunks[0]
                sections += chunks
        part = part_number(sys.argv[1:])
        packs = pack(sections) if part else [sections]
        if part and part > len(packs):
            return 0
        text = SEPARATOR.join(packs[(part or 1) - 1])
        if part and part > 1:
            text = CONTINUED.format(n=part, total=len(packs)) + text
        print(json.dumps({
            "hookSpecificOutput": {
                "hookEventName": "SessionStart",
                "additionalContext": text,
            }
        }))
    except Exception:
        return 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
