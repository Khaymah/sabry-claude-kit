#!/usr/bin/env python3
"""
Runs a kit hook written for Claude Code under another agent's hook protocol.

    python3 hooks/adapt.py <agent> <script> [args...]
    python3 ~/sabry-claude-kit/hooks/adapt.py cursor enforce-commit-style.py

<agent> is one of: claude, codex, gemini, cursor.
<script> is a file name inside hooks/ (or a path relative to the kit root, e.g.
sounds/play.py).

The kit's scripts speak one dialect: a Claude Code payload on stdin (tool_name,
tool_input, cwd) and Claude Code JSON on stdout (hookSpecificOutput.permissionDecision,
additionalContext, or the legacy decision/reason). This file translates both directions
so the same rules run everywhere instead of being forked per tool:

    claude, codex  pass-through. Codex reads the same hooks.json shape and the same
                   PreToolUse output, so no translation is needed.
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


def to_claude(agent, payload):
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


def main():
    if len(sys.argv) < 3:
        print(__doc__.strip(), file=sys.stderr)
        return 0
    agent, script, args = sys.argv[1].lower(), sys.argv[2], sys.argv[3:]
    raw = sys.stdin.read() if not sys.stdin.isatty() else ""
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except Exception:
        payload = {}
    event = payload.get("hook_event_name", "")
    fallback = {"permission": "allow"} if agent == "cursor" and event in CURSOR_PERMISSION_EVENTS else None

    try:
        path = resolve(script)
        if not path:
            raise FileNotFoundError(script)
        p = subprocess.run([sys.executable, path] + args,
                           input=json.dumps(to_claude(agent, payload)),
                           capture_output=True, text=True, timeout=60)
        text = p.stdout.strip()
        out = json.loads(text) if text else None
        result = from_claude(agent, event, out)
    except Exception:
        result = fallback

    if result:
        print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
