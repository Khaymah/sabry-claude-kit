#!/usr/bin/env python3
"""
Runs a kit hook written for Claude Code under another agent's hook protocol.

    python3 hooks/adapt.py <agent> <script> [args...]
    python3 ~/sabry-claude-kit/hooks/adapt.py cursor enforce-commit-style.py

<agent> is one of: claude, codex, kimi, gemini, cursor.
`--once` right after <agent> runs the script at most once per session (by session_id).
<script> is a file name inside hooks/ (or a path relative to the kit root, e.g.
sounds/play.py).

The kit's scripts speak one dialect: a Claude Code payload on stdin (tool_name,
tool_input, cwd) and Claude Code JSON on stdout (hookSpecificOutput.permissionDecision,
additionalContext, or the legacy decision/reason). This file translates both directions
so the same rules run everywhere instead of being forked per tool:

    claude         pass-through.
    codex          same hooks.json shape and PreToolUse output. An apply_patch call is
                   split into one Write/Edit payload per file, so file hooks work; a
                   script's plain-text line becomes {"systemMessage"}.
    kimi           tool and field names are normalised; a deny keeps Claude's shape.
                   SessionStart cannot add context there, so a script's additionalContext
                   is printed as plain text on UserPromptSubmit (use --once).
    gemini         BeforeTool: run_shell_command -> Bash, write_file -> Write,
                   replace -> Edit. A deny becomes {"decision": "deny", "reason"}.
    cursor         beforeShellExecution {command, cwd} -> Bash. A deny becomes
                   {"permission": "deny", user_message, agent_message}; anything else
                   becomes {"permission": "allow"}, because Cursor treats empty or
                   invalid output from a permission hook as a block.
                   sessionStart additionalContext -> additional_context.

Fails open: a crash in translation prints nothing (Cursor: allow) and exits 0.
"""
import json
import os
import re
import subprocess
import sys

KIT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

GEMINI_TOOLS = {
    "run_shell_command": "Bash",
    "write_file": "Write",
    "replace": "Edit",
}

CURSOR_PERMISSION_EVENTS = {"beforeShellExecution", "preToolUse", "beforeMCPExecution",
                            "beforeReadFile"}


def resolve(script):
    for cand in (os.path.join(KIT, "hooks", script), os.path.join(KIT, script)):
        if os.path.isfile(cand):
            return cand
    return None


PATCH_FILE = re.compile(r"^\*\*\* (Add|Update|Delete) File: (.+)$")
KIMI_TOOLS = {"bash": "Bash", "shell": "Bash", "write": "Write", "edit": "Edit", "multiedit": "MultiEdit"}
KIMI_FIELDS = {"path": "file_path", "file": "file_path", "filepath": "file_path",
               "old_str": "old_string", "old_text": "old_string",
               "new_str": "new_string", "new_text": "new_string", "text": "content"}


def patch_payloads(payload):
    """Codex edits files with apply_patch: one patch text, many files. Split it into one
    Write/Edit payload per file so the kit's file hooks see what they expect."""
    ti = payload.get("tool_input") or {}
    text = ti.get("command") or ti.get("patch") or ti.get("input") or ""
    if isinstance(text, list):
        text = "\n".join(str(x) for x in text)
    cwd = payload.get("cwd") or os.getcwd()
    out, current = [], None
    for line in str(text).splitlines():
        m = PATCH_FILE.match(line)
        if m:
            current = None
            if m.group(1) != "Delete":
                path = m.group(2).strip()
                current = {"kind": m.group(1), "path": path if os.path.isabs(path) else os.path.join(cwd, path),
                           "added": [], "removed": []}
                out.append(current)
            continue
        if current is None or line.startswith(("***", "@@")):
            continue
        if line.startswith("+"):
            current["added"].append(line[1:])
        elif line.startswith("-"):
            current["removed"].append(line[1:])
    result = []
    for f in out:
        if f["kind"] == "Add":
            ti2 = {"file_path": f["path"], "content": "\n".join(f["added"]) + "\n"}
            result.append(dict(payload, tool_name="Write", tool_input=ti2))
        else:
            ti2 = {"file_path": f["path"], "old_string": "\n".join(f["removed"]), "new_string": "\n".join(f["added"])}
            result.append(dict(payload, tool_name="Edit", tool_input=ti2))
    return result


def to_claude(agent, payload):
    if agent == "codex":
        if payload.get("tool_name") == "apply_patch":
            return patch_payloads(payload)
        return payload
    if agent == "kimi":
        tool = str(payload.get("tool_name") or "")
        ti = payload.get("tool_input")
        if isinstance(ti, dict):
            ti = {KIMI_FIELDS.get(k, k): v for k, v in ti.items()}
            payload = dict(payload, tool_input=ti)
        if tool.lower() in KIMI_TOOLS:
            payload = dict(payload, tool_name=KIMI_TOOLS[tool.lower()])
        return payload
    if agent == "gemini":
        tool = payload.get("tool_name")
        if tool in GEMINI_TOOLS:
            payload = dict(payload, tool_name=GEMINI_TOOLS[tool])
        return payload
    if agent == "cursor":
        event = payload.get("hook_event_name", "")
        if event in ("beforeShellExecution", "afterShellExecution"):
            roots = payload.get("workspace_roots") or []
            return {
                "hook_event_name": "PreToolUse",
                "tool_name": "Bash",
                "tool_input": {"command": payload.get("command", "")},
                "cwd": payload.get("cwd") or (roots[0] if roots else os.getcwd()),
            }
        if event == "afterFileEdit":
            edits = payload.get("edits") or []
            return {
                "hook_event_name": "PostToolUse",
                "tool_name": "MultiEdit",
                "tool_input": {"file_path": payload.get("file_path"), "edits": edits},
            }
        return payload
    return payload


def deny_reason(out):
    hso = out.get("hookSpecificOutput") or {}
    if hso.get("permissionDecision") == "deny":
        return hso.get("permissionDecisionReason") or "Blocked by sabry-kit."
    if out.get("decision") in ("block", "deny"):
        return out.get("reason") or "Blocked by sabry-kit."
    return None


def from_claude(agent, event, out):
    if agent in ("claude", "codex"):
        return out
    reason = deny_reason(out) if out else None
    context = ((out or {}).get("hookSpecificOutput") or {}).get("additionalContext")
    if agent == "kimi":
        if reason:
            return {"hookSpecificOutput": {"permissionDecision": "deny", "permissionDecisionReason": reason}}
        if event == "UserPromptSubmit" and context:
            return context
        return None
    if agent == "gemini":
        if reason:
            return {"decision": "deny", "reason": reason}
        return out
    if agent == "cursor":
        if event in CURSOR_PERMISSION_EVENTS:
            if reason:
                return {"permission": "deny", "user_message": reason, "agent_message": reason}
            return {"permission": "allow"}
        if event == "sessionStart" and context:
            return {"additional_context": context}
        return None
    return out


def once_marker(agent, script, payload):
    safe = lambda v: re.sub(r"[^A-Za-z0-9_.-]", "", str(v))[:64]
    sid = safe(payload.get("session_id") or "")
    if not sid:
        return None
    return os.path.join(os.path.expanduser("~"), ".agents", "state", f"once-{agent}-{safe(script)}-{sid}")


def run_script(path, args, payload):
    p = subprocess.run([sys.executable, path] + args, input=json.dumps(payload),
                       capture_output=True, text=True, timeout=120)
    text = p.stdout.strip()
    try:
        return json.loads(text) if text else None, text
    except ValueError:
        return None, text


def main():
    argv = sys.argv[1:]
    if len(argv) < 2:
        print(__doc__.strip(), file=sys.stderr)
        return 0
    agent = argv[0].lower()
    rest = argv[1:]
    once = "--once" in rest[:1]
    if once:
        rest = rest[1:]
    if not rest:
        return 0
    script, args = rest[0], rest[1:]
    raw = sys.stdin.read() if not sys.stdin.isatty() else ""
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except Exception:
        payload = {}
    if not isinstance(payload, dict):
        payload = {}
    event = payload.get("hook_event_name", "")
    fallback = {"permission": "allow"} if agent == "cursor" and event in CURSOR_PERMISSION_EVENTS else None

    try:
        if once:
            marker = once_marker(agent, script, payload)
            if marker:
                if os.path.exists(marker):
                    return 0
                os.makedirs(os.path.dirname(marker), exist_ok=True)
                open(marker, "w").close()
        path = resolve(script)
        if not path:
            raise FileNotFoundError(script)
        converted = to_claude(agent, payload)
        result, plain = None, ""
        for item in converted if isinstance(converted, list) else [converted]:
            out, plain = run_script(path, args, item)
            result = from_claude(agent, event, out)
            if out and deny_reason(out):
                break
        if agent == "codex" and result is None and plain and event != "Stop":
            result = {"systemMessage": plain}
    except Exception:
        result = fallback

    if isinstance(result, str):
        print(result)
    elif result:
        print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
