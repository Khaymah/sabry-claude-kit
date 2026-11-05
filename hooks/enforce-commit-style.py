#!/usr/bin/env python3
"""
PreToolUse hook — enforces the owner's absolute commit rules:

  1. No AI attribution anywhere in a commit or PR body
     (Co-Authored-By: Claude, "Generated with Claude Code", robot emoji, Anthropic).
  2. Commit messages are written in English, not Arabic.
  3. Commits are authored and committed by the owner, never by an AI identity.
     Cloud sessions ship a global `Claude <noreply@anthropic.com>` identity, so without
     this check every commit carries Claude's name even with a clean message. The identity
     is resolved the way git resolves it: --author, GIT_AUTHOR_*/GIT_COMMITTER_* (in the
     command or the environment), `git -c user.*`, then `git config`. An --amend without
     --reset-author keeps HEAD's author, so HEAD is checked instead. The fix names the
     owner's identity from the profile (git_name / git_email) when it is there.

Why a hook and not CLAUDE.md: rule 1 contradicts a standing instruction in the model's
own system prompt ("End commit messages with: Co-Authored-By: Claude ..."), and rule 2
was violated repeatedly despite being asked for. Instructions lose to instructions; a hook
does not.

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

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    import kit_config
except Exception:
    kit_config = None

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

_QUOTED = r"(\"(?:[^\"\\]|\\.)*\"|'[^']*'|\S+)"

# One shell word, with quoted runs inside it: x, "a b", user.name="Jane Doe".
_WORD = r"(?:[^\s\"']|\"(?:[^\"\\]|\\.)*\"|'[^']*')+"

# VAR=value prefixes, quoted values included (GIT_AUTHOR_NAME="Jane Doe" git commit).
_ENV_PREFIX = r"(?:\w+=" + _WORD + r"\s+)*"

# git's own global options that may sit before the subcommand: -C <dir>, -c <key=value>.
_GIT_OPTS = r"(?:-[Cc]\s+" + _WORD + r"\s+)*"

WRITES_MESSAGE = re.compile(
    _CMD_START + _ENV_PREFIX +
    r"(?:git\s+" + _GIT_OPTS + r"(?:commit|tag\b[^\n]*-[am])|"
    r"gh\s+(?:pr|issue|release)\s+(?:create|edit|comment))",
    re.IGNORECASE,
)

IS_GIT_COMMIT = re.compile(
    _CMD_START + _ENV_PREFIX + r"git\s+" + _GIT_OPTS + r"commit\b", re.IGNORECASE)

# An AI identity: "Claude" as a word (not Claudette), or anything Anthropic.
AI_IDENTITY = re.compile(r"\bclaude\b|anthropic", re.IGNORECASE)

KIT_HOOKS = os.path.dirname(os.path.abspath(__file__))


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


def _git_value(workdir: str, *args: str) -> str:
    """One read-only git lookup. Any failure is an empty answer, never a block."""
    try:
        out = subprocess.run(
            ["git", "-C", workdir, *args],
            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=5,
        )
        return out.stdout.strip() if out.returncode == 0 else ""
    except Exception:
        return ""


def commit_identities(command: str, cwd: str) -> list:
    """[(role, "Name <email>")] for the author and committer this commit would record."""
    m = IS_GIT_COMMIT.search(command)
    if not m:
        return []
    end = command.find("\n", m.end())
    segment = command[m.start():end if end != -1 else len(command)]
    workdir = _workdir(command, cwd)

    inline_env = {key: _unquote(value) for key, value in re.findall(
        r"\b(GIT_(?:AUTHOR|COMMITTER)_(?:NAME|EMAIL))=" + _QUOTED, segment)}
    overrides = {key.lower(): _unquote(value) for key, value in re.findall(
        r"\s-c\s+(user\.(?:name|email))=" + _QUOTED, segment, re.IGNORECASE)}

    def pick(role: str, field: str) -> str:
        key = f"GIT_{role}_{field}"
        return (inline_env.get(key) or os.environ.get(key)
                or overrides.get(f"user.{field.lower()}")
                or _git_value(workdir, "config", f"user.{field.lower()}"))

    committer = f"{pick('COMMITTER', 'NAME')} <{pick('COMMITTER', 'EMAIL')}>"
    flag = re.search(r"--author[= ]+" + _QUOTED, segment)
    if flag:
        author = _unquote(flag.group(1))
    elif re.search(r"--amend\b", segment) and not re.search(r"--reset-author\b", segment):
        author = (_git_value(workdir, "log", "-1", "--format=%an <%ae>", "HEAD")
                  or f"{pick('AUTHOR', 'NAME')} <{pick('AUTHOR', 'EMAIL')}>")
    else:
        author = f"{pick('AUTHOR', 'NAME')} <{pick('AUTHOR', 'EMAIL')}>"
    return [("author", author), ("committer", committer)]


def owner_identity(cwd: str) -> tuple:
    """(name, email) the owner saved with kit-setup, or empty strings."""
    if not kit_config:
        return "", ""
    try:
        profile = kit_config.load_profile(kit_config.project_root(cwd))
    except Exception:
        return "", ""
    name = str(profile.get("git_name") or "").strip()
    email = str(profile.get("git_email") or "").strip()
    if AI_IDENTITY.search(f"{name} {email}"):
        return "", ""
    return name, email


def identity_fix(cwd: str, amend_keeps_author: bool) -> str:
    name, email = owner_identity(cwd)
    reset = " Add --reset-author so the amended commit takes the new identity." if amend_keeps_author else ""
    if name and email:
        return (f'Fix: git config user.name "{name}" && git config user.email "{email}", '
                f"then re-run.{reset}")
    return (
        "Fix: ask the owner for their git name and email (AskUserQuestion), run "
        'git config user.name "<name>" && git config user.email "<email>" in this repo, '
        "and save them once so every future session applies them automatically:\n"
        f"python3 \"{os.path.join(KIT_HOOKS, 'kit_profile.py')}\" set "
        "'{\"git_name\":\"<name>\",\"git_email\":\"<email>\"}'" + reset
    )


HEREDOC = re.compile(r"<<-?\s*(['\"]?)(\w+)\1[^\n]*\n(.*?)\n\s*\2\b", re.DOTALL)
SHELL_OPENER = re.compile(r"(?:^|[\s;&|(])(?:ba|z|da)?sh(?:\s+-s)?\s*$")


def _opener(command: str, start: int) -> str:
    return command[command.rfind("\n", 0, start) + 1:start]


def visible_command(command: str) -> str:
    """The command with the bodies of heredocs that are data for another program removed.

    A heredoc fed to python/cat/tee is file content, not shell: a `git commit` line or
    Arabic text inside it is not a commit. Heredocs that feed a shell (bash/sh) stay,
    because their lines do run; so do heredocs opened on the commit line itself, which
    are the message.
    """
    out, last = [], 0
    for m in HEREDOC.finditer(command):
        opener = _opener(command, m.start())
        if WRITES_MESSAGE.search(opener) or SHELL_OPENER.search(opener.rstrip()):
            continue
        out.append(command[last:m.start(3)])
        last = m.end(3)
    out.append(command[last:])
    return "".join(out)


def message_text(command: str, cwd: str = "") -> str:
    """Best-effort extraction of author-written text: flag values, heredocs, and -F files."""
    parts = []

    # -m "..." / --message=... and gh's --body / -b / --notes
    for m in re.finditer(r"(?:-m|--message|-b|--body|--notes)[= ]+" + _QUOTED, command):
        parts.append(_unquote(m.group(1)))

    # heredoc bodies:  <<'EOF' ... EOF   /   <<EOF ... EOF
    for m in HEREDOC.finditer(command):
        if WRITES_MESSAGE.search(_opener(command, m.start())):
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

    if kit_config and not kit_config.gate("commit_style", payload):
        return 0

    tool_input = payload.get("tool_input") or {}
    if not isinstance(tool_input, dict):
        return 0

    command = tool_input.get("command") or ""
    if not isinstance(command, str):
        return 0
    command = visible_command(command)
    if not WRITES_MESSAGE.search(command):
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
                "The owner's rule, all projects: NO AI attribution in commits or PR bodies — "
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
            "The owner's rule, all projects: commit subject and body in ENGLISH.\n"
            "Arabic belongs in PROGRESS.md, Plan/, Decisions/ and the conversation — not git history.\n"
            "Fix: rewrite the message in English and re-run."
        )

    # Rule 3: who the commit is recorded as, independent of what the message says.
    for role, identity in commit_identities(command, cwd):
        if AI_IDENTITY.search(identity):
            amend_keeps_author = (
                role == "author"
                and re.search(r"--amend\b", command) is not None
                and re.search(r"--reset-author\b|--author\b", command) is None
            )
            return deny(
                f"[enforce-commit-style] Blocked: this commit's {role} would be {identity!r}, "
                "an AI identity.\n"
                "The owner's rule, all projects: commits carry the owner's name, never Claude's "
                "or Anthropic's, as author or committer.\n"
                + identity_fix(cwd, amend_keeps_author)
            )

    return 0


if __name__ == "__main__":
    sys.exit(main())
