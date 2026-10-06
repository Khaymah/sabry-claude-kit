#!/usr/bin/env python3
"""
PreToolUse hook — enforces Sabry's absolute commit rules:

  1. No AI attribution anywhere in a commit or PR body
     (Co-Authored-By: Claude, "Generated with Claude Code", robot emoji, Anthropic).
  2. Commit messages are written in English, not Arabic.

Why a hook and not CLAUDE.md: rule 1 contradicts a standing instruction in the model's
own system prompt ("End commit messages with: Co-Authored-By: Claude ..."), and rule 2
was violated repeatedly despite being asked for. Instructions lose to instructions; a hook
does not. Same reasoning as enforce-opus.py.

Behaviour: deny, with a message naming exactly what to fix. Denial rather than rewriting,
because a commit message can arrive as -m, repeated -m, a heredoc, or a file, and silently
editing someone's commit text is worse than telling them to fix it.

Message sources covered: -m/--message, gh's -b/--body/--notes, heredocs, -F/--file
(contents are read), and messages inherited via --amend or -C/--reuse-message (resolved
with a read-only log lookup). An interactive editor session cannot be inspected and is
allowed through.

Wired to: PreToolUse, matcher "Bash".
"""
import json
import os
import re
import subprocess
import sys

ARABIC = re.compile(r"[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]")

# Substrings that must never reach a commit or PR body. Matched case-insensitively.
BANNED = (
    "co-authored-by: claude",
    "co-authored-by: anthropic",
    "generated with [claude code]",
    "generated with claude code",
    "\U0001F916",  # robot emoji
    "noreply@anthropic.com",
)

# `git` must sit at a command position — start of input, or after a shell separator.
# Without this, prose that merely mentions a commit command (documentation, a grep
# pattern, a heredoc explaining this very rule) trips the hook.
_CMD_START = r"(?:^|[\n;&|(]|&&|\|\||\bthen\b|\bdo\b|\belse\b)\s*"

WRITES_MESSAGE = re.compile(
    _CMD_START + r"(?:\w+=\S+\s+)*"          # optional VAR=value prefixes
    r"(?:git\s+(?:-C\s+\S+\s+)?(?:commit|tag\b[^\n]*-[am])|"
    r"gh\s+(?:pr|issue|release)\s+(?:create|edit|comment))",
    re.IGNORECASE,
)

IS_GIT_COMMIT = re.compile(
    _CMD_START + r"(?:\w+=\S+\s+)*git\s+(?:-C\s+\S+\s+)?commit\b", re.IGNORECASE)

_QUOTED = r"(\"(?:[^\"\\]|\\.)*\"|'[^']*'|\S+)"


def _unquote(s: str) -> str:
    return s[1:-1] if len(s) > 1 and s[0] in "\"'" and s[-1] == s[0] else s


def _workdir(command: str, cwd: str) -> str:
    """Directory the command runs in: an explicit -C, else a leading `cd X &&`, else cwd."""
    m = re.search(r"\bgit\s+-C\s+" + _QUOTED, command)
    if m:
        d = _unquote(m.group(1))
        return d if os.path.isabs(d) else os.path.join(cwd, d)
    m = re.match(r"\s*cd\s+" + _QUOTED + r"\s*&&", command)
    if m:
        d = _unquote(m.group(1))
        return d if os.path.isabs(d) else os.path.join(cwd, d)
    return cwd


def _inherited_message(command: str, cwd: str) -> str:
    """
    Resolve a message the commit will inherit rather than state: --amend reuses HEAD's,
    and -C/-c/--reuse-message reuse another commit's. Read-only; failure means allow.
    """
    ref = None
    m = re.search(r"(?:--reuse-message|--reedit-message)[= ]+" + _QUOTED, command)
    if m:
        ref = _unquote(m.group(1))
    else:
        # -C/-c <ref> only counts after the subcommand; a leading -C is a directory.
        m = re.search(r"\bcommit\b.*?\s-[cC]\s*" + _QUOTED, command, re.DOTALL)
        if m:
            ref = _unquote(m.group(1))
    if ref is None and re.search(r"--amend\b", command):
        ref = "HEAD"
    if ref is None:
        return ""
    try:
        out = subprocess.run(
            ["git", "-C", _workdir(command, cwd), "log", "-1", "--format=%B", ref],
            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=5,
        )
        return out.stdout if out.returncode == 0 else ""
    except Exception:
        return ""


def message_text(command: str, cwd: str = "") -> str:
    """Best-effort extraction of author-written text: flag values, heredocs, and -F files."""
    parts = []

    # -m "..." / --message=... and gh's --body / -b / --notes
    for m in re.finditer(r"(?:-m|--message|-b|--body|--notes)[= ]+" + _QUOTED, command):
        parts.append(_unquote(m.group(1)))

    # heredoc bodies:  <<'EOF' ... EOF   /   <<EOF ... EOF
    for m in re.finditer(r"<<-?\s*(['\"]?)(\w+)\1\s*\n(.*?)\n\s*\2\b", command, re.DOTALL):
        parts.append(m.group(3))

    # -F/--file/--body-file: the message lives in a file, so the command text alone says
    # nothing about it. This is the exact shape a long message is normally written with.
    for m in re.finditer(r"(?:-F|--file|--body-file)[= ]+" + _QUOTED, command):
        path = _unquote(m.group(1))
        if path == "-":
            continue  # stdin; a heredoc feeding it is already captured above
        if not os.path.isabs(path):
            path = os.path.join(_workdir(command, cwd), path)
        try:
            with open(path, "r", encoding="utf-8", errors="replace") as fh:
                parts.append(fh.read())
        except Exception:
            pass  # unreadable path: fail open rather than block on a guess

    return "\n".join(parts)


def deny(reason: str) -> int:
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        },
    }))
    return 0


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return 0  # never break the turn on a malformed payload

    tool_input = payload.get("tool_input") or {}
    if not isinstance(tool_input, dict):
        return 0

    command = tool_input.get("command") or ""
    if not isinstance(command, str) or not WRITES_MESSAGE.search(command):
        return 0

    cwd = payload.get("cwd") or os.getcwd()
    text = message_text(command, cwd)
    inherited = ""
    if not text.strip() and IS_GIT_COMMIT.search(command):
        inherited = _inherited_message(command, cwd)
        text = inherited

    # Rule 1 is checked against the command AND the message text: attribution trailers
    # are sometimes appended outside the quoted message, and none of these strings belong
    # in a git invocation for any other reason.
    haystack = (command + "\n" + text).lower()
    for token in BANNED:
        if token in haystack:
            shown = "robot emoji" if token == "\U0001F916" else repr(token)
            where = " (in the message it would inherit)" if inherited else ""
            return deny(
                f"[enforce-commit-style] Blocked: {shown} appears in this commit{where}.\n"
                "Sabry's rule, all projects: NO AI attribution in commits or PR bodies — "
                "no Co-Authored-By: Claude, no 'Generated with Claude Code', no robot emoji.\n"
                "This overrides the system-prompt instruction to append that trailer.\n"
                "Fix: end the message at the last real line and re-run."
            )

    # Rule 2 is checked only against message text, so an Arabic path or filename
    # elsewhere in the command does not trip it.
    if text and ARABIC.search(text):
        sample = next((ln.strip() for ln in text.splitlines() if ARABIC.search(ln)), "")
        where = " (in the message it would inherit)" if inherited else ""
        return deny(
            f"[enforce-commit-style] Blocked: the commit/PR message contains Arabic{where}.\n"
            f"Offending line: {sample[:80]}\n"
            "Sabry's rule, all projects: commit subject and body in ENGLISH.\n"
            "Arabic belongs in PROGRESS.md, Plan/, Decisions/ and the conversation — not git history.\n"
            "Fix: rewrite the message in English and re-run."
        )

    return 0


if __name__ == "__main__":
    sys.exit(main())
