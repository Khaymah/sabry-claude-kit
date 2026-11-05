#!/usr/bin/env python3
"""
SessionStart hook — commits carry the owner's name, never the AI's.

Cloud sessions start with a global git identity of `Claude <noreply@anthropic.com>`, so
every commit is authored by Claude unless something changes it. This hook reads the owner's
identity from the profile (`git_name`, `git_email`, saved by kit-setup; the profile is
account-wide once uploaded) and applies it with `git config`:

  - global identity missing, or an AI identity  -> set the global one
  - this repository has its own AI identity     -> replace it too (it would win over global)
  - a real person's identity                    -> never touched

No identity in the profile while git would commit as an AI -> one line of context telling
the agent to ask the owner before the first commit. enforce-commit-style blocks such a
commit either way; this hook is what makes the block rare.

Switch: settings.git_identity (default on). Wired to: SessionStart.
"""
import json
import os
import re
import shutil
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    import kit_config
except Exception:
    kit_config = None

AI_IDENTITY = re.compile(r"\bclaude\b|anthropic", re.IGNORECASE)
KIT_PROFILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "kit_profile.py")


def git(*args):
    try:
        p = subprocess.run(["git", *args], capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=5)
        return p.stdout.strip() if p.returncode == 0 else ""
    except Exception:
        return ""


def is_ai(name, email):
    return bool(AI_IDENTITY.search(f"{name} {email}"))


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        payload = {}
    if not isinstance(payload, dict):
        payload = {}

    if shutil.which("git") is None:
        return 0
    if kit_config and not kit_config.gate("git_identity", payload):
        return 0

    cwd = payload.get("cwd") or os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()
    root = kit_config.project_root(cwd) if kit_config else None
    profile = kit_config.load_profile(root) if kit_config else {}
    name = str(profile.get("git_name") or "").strip()
    email = str(profile.get("git_email") or "").strip()

    global_name = git("config", "--global", "user.name")
    global_email = git("config", "--global", "user.email")
    global_needs = not (global_name and global_email) or is_ai(global_name, global_email)

    local_needs = False
    if root:
        local_name = git("-C", root, "config", "--local", "user.name")
        local_email = git("-C", root, "config", "--local", "user.email")
        local_needs = bool(local_name or local_email) and is_ai(local_name, local_email)

    if not (global_needs or local_needs):
        return 0

    if not (name and email) or is_ai(name, email):
        if local_needs or is_ai(global_name, global_email):
            print(
                "[git-identity] git would commit as an AI identity and the profile has no "
                "git_name/git_email. Before the first commit, ask the owner for their git name "
                "and email (AskUserQuestion), then save them once:\n"
                f"python3 \"{KIT_PROFILE}\" set "
                "'{\"git_name\":\"<name>\",\"git_email\":\"<email>\"}'"
            )
        return 0

    applied = []
    if global_needs:
        git("config", "--global", "user.name", name)
        git("config", "--global", "user.email", email)
        applied.append("global")
    if local_needs:
        git("-C", root, "config", "--local", "user.name", name)
        git("-C", root, "config", "--local", "user.email", email)
        applied.append("this repository")
    print(f"[git-identity] Commits are authored as {name} <{email}> ({', '.join(applied)}).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
