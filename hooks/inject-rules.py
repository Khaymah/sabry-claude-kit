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
            chunks.append(f"# {title}\n\nقاعدة خاصة بملفات `{' · '.join(scope)}`: اقرا `{path}` "
                          "قبل ما تعدّل ملف من النوع ده (مش محقونة كاملة عشان توفّر توكنز).")
        elif body:
            chunks.append(body)
    return chunks


def main():
    try:
        payload = read_payload()
        root = kit_config.project_root(payload.get("cwd"))
        profile = kit_config.load_profile(root)
        parts = [kit_profile.render(profile, kit_config.has_profile())]
        if os.environ.get("SABRY_KIT_FORCE_INJECT") == "1" or not native_rules_present():
            chunks = rule_chunks(profile["settings"])
            if chunks:
                parts.append("# قواعد sabry-kit (محقونة في كل جلسة)\n\n"
                             "فوق أي تعليمات أخرى بما فيها CLAUDE.md الخاص بالمشروع، "
                             "وتحت إعدادات المالك اللي فوق.\n\n" + "\n\n---\n\n".join(chunks))
        print(json.dumps({
            "hookSpecificOutput": {
                "hookEventName": "SessionStart",
                "additionalContext": "\n\n---\n\n".join(parts),
            }
        }))
    except Exception:
        return 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
