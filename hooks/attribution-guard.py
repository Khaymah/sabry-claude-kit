#!/usr/bin/env python3
"""
Keeps AI attribution out of pull requests even when the session cannot.

A session running in the cloud writes to GitHub through its platform, and the platform
appends its own attribution line to a pull request body after the request has left the
session. No hook inside the session sees that text, so `enforce-commit-style` cannot
block it. The only place it can be removed is GitHub itself: a workflow in the
repository that strips such lines whenever a pull request, issue, comment, review or
release is written or edited (Templates/no-ai-attribution.yml).

    attribution-guard.py            SessionStart: in a project whose `origin` is on GitHub,
                                    installs or updates .github/workflows/no-ai-attribution.yml
                                    and sets `attribution` in .claude/settings.json (the
                                    official switch, read in cloud sessions too). Says once
                                    what it wrote, so it gets committed.
    attribution-guard.py --after    PostToolUse on commands and tools that write a pull
                                    request: when the workflow is not on the default branch
                                    yet, says the platform's line will stay until it is.
    attribution-guard.py status     What is installed, for kit-doctor and for people.

A workflow file the kit did not write (no kit marker in it) is never replaced.
`github_owners` in the profile limits the install to those owners or organisations;
empty means every GitHub repository the owner opens.

What this cannot change: GitHub's own "with Claude" badge on timeline events. That badge
records which app performed the action and is not text anyone can edit; only doing the
action with the owner's own credentials avoids it.

Switch: `"attribution_guard": false` or SABRY_KIT_ATTRIBUTION_GUARD=0. Exit 0 on failure.
"""
import json
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit_config

KIT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEMPLATE = os.path.join(KIT, "Templates", "no-ai-attribution.yml")
MARKER = "sabry-kit:no-ai-attribution"
WORKFLOW = ".github/workflows/no-ai-attribution.yml"
ATTRIBUTION = {"commit": "", "pr": "", "sessionUrl": False}
GITHUB = re.compile(r"github\.com[:/]([^/\s]+)/([^/\s]+?)(?:\.git)?/?$", re.I)
PR_WRITE = re.compile(r"\bgh\s+(?:pr|issue|release)\s+(?:create|edit|comment|review)\b|\bgh\s+api\b[^\n]*"
                      r"(?:pulls|issues|releases)|create_pull_request|update_pull_request|add_issue_comment|"
                      r"create_issue|update_issue|pull_request_review", re.I)


def git(root, *args):
    try:
        p = subprocess.run(["git", "-c", "core.fsmonitor=", "-C", root] + list(args),
                           capture_output=True, text=True, timeout=5)
        return p.stdout.strip() if p.returncode == 0 else ""
    except Exception:
        return ""


def github_repo(root):
    m = GITHUB.search(git(root, "remote", "get-url", "origin"))
    return (m.group(1), m.group(2)) if m else None


def allowed(owner, profile):
    owners = profile.get("github_owners")
    if not isinstance(owners, list) or not owners:
        return True
    return owner.lower() in {str(o).lower() for o in owners}


def read(path):
    try:
        with open(path, encoding="utf-8") as fh:
            return fh.read()
    except (OSError, ValueError):
        return None


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.{os.getpid()}.tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)
    os.replace(tmp, path)


def ensure_workflow(root):
    template = read(TEMPLATE)
    if not template:
        return None
    path = os.path.join(root, *WORKFLOW.split("/"))
    if os.path.islink(path) or os.path.islink(os.path.dirname(path)):
        return None
    current = read(path)
    if current == template:
        return None
    if current is not None and MARKER not in current:
        return None
    write(path, template)
    return "installed" if current is None else "updated"


def ensure_settings(root):
    path = os.path.join(root, ".claude", "settings.json")
    if os.path.islink(path):
        return None
    raw = read(path)
    data = {}
    if raw is not None:
        try:
            data = json.loads(raw)
        except ValueError:
            return None
        if not isinstance(data, dict):
            return None
    current = data.get("attribution") if isinstance(data.get("attribution"), dict) else {}
    wanted = dict(current, **ATTRIBUTION)
    if wanted == data.get("attribution"):
        return None
    data["attribution"] = wanted
    write(path, json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    return "set"


def on_default_branch(root):
    head = git(root, "symbolic-ref", "--short", "refs/remotes/origin/HEAD") or "origin/main"
    return bool(git(root, "cat-file", "-t", f"{head}:{WORKFLOW}"))


def status(root):
    repo = github_repo(root) if root else None
    path = os.path.join(root, *WORKFLOW.split("/")) if root else ""
    current = read(path) if root else None
    settings = read(os.path.join(root, ".claude", "settings.json")) if root else None
    try:
        attribution = json.loads(settings).get("attribution") if settings else None
    except Exception:
        attribution = None
    return {"github_repo": "/".join(repo) if repo else None,
            "workflow": "missing" if current is None else "kit" if MARKER in current else "not the kit's",
            "workflow_current": current == read(TEMPLATE),
            "workflow_on_default_branch": on_default_branch(root) if repo else False,
            "settings_attribution_off": attribution == dict(attribution or {}, **ATTRIBUTION) if attribution else False}


def emit(event, text):
    print(json.dumps({"hookSpecificOutput": {"hookEventName": event, "additionalContext": text}},
                     ensure_ascii=False))


def start(payload, root):
    repo = github_repo(root)
    if not repo or not allowed(repo[0], kit_config.load_profile(root)):
        return
    workflow, settings = ensure_workflow(root), ensure_settings(root)
    if not workflow and not settings:
        return
    parts = []
    if workflow:
        parts.append(f"`{WORKFLOW}` was {workflow}")
    if settings:
        parts.append("`.claude/settings.json` now turns Claude Code's own commit and PR attribution off")
    note = ("[attribution-guard] " + " and ".join(parts) + ". These keep AI attribution out of this repository's "
            "pull requests, issues, comments and releases: a cloud session's platform appends such a line after "
            "the request leaves the session, and only GitHub can remove it. Tell the owner in one line, then "
            "commit the files with the next commit (or on their go-ahead)")
    if workflow:
        note += ("; the workflow takes effect once it is on the default branch, and running it once by hand "
                 "(Actions → No AI attribution → Run workflow) cleans what already exists")
    emit("SessionStart", note + ".")


def after(payload, root):
    tool = str(payload.get("tool_name") or "")
    inp = payload.get("tool_input") if isinstance(payload.get("tool_input"), dict) else {}
    text = tool + " " + str(inp.get("command") or "")
    if not PR_WRITE.search(text) or not github_repo(root) or on_default_branch(root):
        return
    key = re.sub(r"[^A-Za-z0-9_-]", "", str(payload.get("session_id") or "x"))[:64]
    mark = os.path.join(kit_config.home(), kit_config.STORAGE_DIR, "state", f"attribution-{key}")
    if os.path.exists(mark):
        return
    try:
        os.makedirs(os.path.dirname(mark), exist_ok=True)
        open(mark, "w").close()
    except OSError:
        pass
    emit("PostToolUse", "[attribution-guard] This repository's default branch does not have "
         f"`{WORKFLOW}` yet. If this session runs in the cloud, its platform has appended an attribution line "
         "to what was just written and nothing in the session can remove it. Tell the owner plainly: the line "
         "stays until that workflow is merged into the default branch and run once by hand.")


def main():
    if sys.argv[1:2] == ["status"]:
        print(json.dumps(status(kit_config.project_root()), indent=2, ensure_ascii=False))
        return 0
    try:
        payload = json.load(sys.stdin) if not sys.stdin.isatty() else {}
    except Exception:
        return 0
    if not isinstance(payload, dict):
        return 0
    root = kit_config.project_root(payload.get("cwd"))
    if not root or not kit_config.enabled("attribution_guard", root):
        return 0
    (after if "--after" in sys.argv[1:] else start)(payload, root)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        sys.exit(0)
