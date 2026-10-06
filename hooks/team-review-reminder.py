#!/usr/bin/env python3
"""
Stop hook — deterministic reminder to run a team review when code actually changed.

Non-blocking by design: it injects context, it never forces. CLAUDE.md is advisory and can be
forgotten; this cannot be. But it also never holds the turn hostage.

Registered globally, so it runs in every repository. That makes one distinction essential:
**changed this session** vs **dirty working tree**. A repo opened with 40 uncommitted files
is not 40 files the agent just wrote, and reporting them would be exactly the noise this is
meant to avoid. `--baseline` (wired to SessionStart) snapshots the tree; the Stop pass reports
only files whose fingerprint moved since.

Fires at most once per distinct change-set, so it does not nag while work continues on the
same change.

Silent and exit-0 in every failure path — a reminder is never worth breaking a turn over.
"""
import hashlib
import json
import os
import subprocess
import sys

# path fragment -> (angle, agent). First match per angle wins.
ANGLE_RULES = [
    ("security-reviewer", (
        "auth", "login", "session", "token", "jwt", "oauth", "password", "secret",
        "crypt", "payment", "billing", "stripe", "webhook", "middleware", "permission",
        "acl", "role", "upload", ".env",
    )),
    ("ux-reviewer", (".tsx", ".jsx", ".vue", ".svelte", ".css", ".scss", "component", "page")),
    ("devops-sre", (
        "dockerfile", "docker-compose", ".github/workflows", ".gitlab-ci",
        "k8s", "kubernetes", "helm", "nginx", "terraform", "deploy",
    )),
]

CODE_EXT = (
    ".ts", ".tsx", ".js", ".jsx", ".vue", ".svelte", ".go", ".rs", ".py",
    ".cs", ".php", ".sql", ".css", ".scss",
)
TEST_HINTS = (".test.", ".spec.", "__tests__", "/tests/", "/test/")

CONFIG_DIR = os.path.abspath(
    os.environ.get("CLAUDE_CONFIG_DIR") or os.path.join(os.path.expanduser("~"), ".claude")
)
# State lives centrally, keyed by repo path. Running in every repository Sabry opens, writing
# state inside each one would litter unrelated projects with an untracked `.claude/` directory.
STATE_DIR = os.path.join(CONFIG_DIR, ".state", "review-reminders")


def sh(*args: str) -> str:
    """Run git and return stdout with only TRAILING whitespace removed.

    `.strip()` would eat the leading space of `git status --porcelain` output — that space is
    the unstaged status column, so the first line's path would silently lose its first
    character ('src/a.ts' -> 'rc/a.ts'). Only the first line, which is why it survives casual
    testing.
    """
    try:
        return subprocess.run(
            args, capture_output=True, text=True, timeout=8,
        ).stdout.rstrip()
    except Exception:
        return ""


def repo_root() -> str:
    """Repo root, or "" if not in one / if this is the Claude config repo itself."""
    out = sh("git", "rev-parse", "--is-inside-work-tree", "--show-toplevel").splitlines()
    if len(out) < 2 or out[0].strip() != "true":
        return ""
    root = os.path.abspath(out[1].strip())
    # The config repo is code too, but suggesting a review every time a hook or agent file is
    # touched is pure noise — and these get edited constantly. One precise exclusion, not a
    # broad filter that could silence a real project.
    if os.path.normcase(root) == os.path.normcase(CONFIG_DIR):
        return ""
    return root


def fingerprints(root: str) -> dict:
    """{path: fingerprint} for every dirty file. Two git calls plus local stat()s.

    Tracked files are fingerprinted by their status code and numstat line counts; untracked
    ones (absent from `git diff`) by size and mtime. Enough to tell "this file moved since
    the snapshot" without hashing contents.
    """
    status = sh("git", "status", "--porcelain", "-uall")
    if not status:
        return {}

    numstat = {}
    for line in sh("git", "diff", "HEAD", "--numstat").splitlines():
        parts = line.split("\t")
        if len(parts) >= 3:
            numstat[parts[2].strip().strip('"')] = f"{parts[0]}+{parts[1]}-"

    fps = {}
    for line in status.splitlines():
        if len(line) < 4:
            continue
        code, path = line[:2], line[3:].strip().strip('"')
        if " -> " in path:                      # rename: keep the destination
            path = path.split(" -> ", 1)[1].strip().strip('"')
        # Skip tooling state — settings, local overrides, agent definitions. Configuration,
        # not the code a reviewer would look at.
        if not path or path.startswith(".claude/") or "/.claude/" in path:
            continue
        fp = numstat.get(path)
        if fp is None:
            try:
                st = os.stat(os.path.join(root, path))
                fp = f"{st.st_size}:{st.st_mtime_ns}"
            except OSError:
                fp = "?"
        fps[path] = f"{code}|{fp}"
    return fps


def state_path(root: str, suffix: str = "") -> str:
    h = hashlib.sha256(root.encode()).hexdigest()[:16]
    return os.path.join(STATE_DIR, h + suffix)


def write_state(path: str, text: str) -> None:
    try:
        os.makedirs(STATE_DIR, exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(text)
    except Exception:
        pass


def read_state(path: str):
    try:
        with open(path, encoding="utf-8") as fh:
            return fh.read()
    except Exception:
        return None


def main() -> int:
    baseline_mode = "--baseline" in sys.argv

    if not baseline_mode:
        try:
            payload = json.load(sys.stdin)
        except Exception:
            return 0
        # Loop protection — mandated by the hook contract.
        if payload.get("stop_hook_active"):
            return 0

    root = repo_root()
    if not root:
        return 0

    base_file = state_path(root, ".baseline")
    cur = fingerprints(root)

    if baseline_mode:
        write_state(base_file, json.dumps(cur))
        return 0

    raw = read_state(base_file)
    if raw is None:
        # No snapshot — cannot tell this session's work from pre-existing dirt. Establish the
        # baseline and stay quiet rather than dumping the whole working tree at Sabry.
        write_state(base_file, json.dumps(cur))
        return 0
    try:
        base = json.loads(raw)
    except Exception:
        write_state(base_file, json.dumps(cur))
        return 0

    files = [p for p, fp in cur.items() if base.get(p) != fp]
    if not files:
        return 0

    code = [f for f in files if f.lower().endswith(CODE_EXT)]
    if not code:
        return 0  # docs/config only — nothing for the team to review

    # Fire once per distinct change-set: further edits to the same files change the
    # fingerprints, so they count as a new one.
    key = hashlib.sha256(
        "|".join(f"{p}={cur[p]}" for p in sorted(files)).encode()
    ).hexdigest()[:16]
    last = state_path(root)
    if read_state(last) == key:
        return 0
    write_state(last, key)

    lower = [f.lower() for f in files]
    angles = ["code-reviewer"]
    for agent, needles in ANGLE_RULES:
        if any(n in f for f in lower for n in needles):
            angles.append(agent)

    if not any(h in f for f in lower for h in TEST_HINTS):
        angles.append("qa-tester")

    shown = ", ".join(f"`{a}`" for a in angles)
    sample = ", ".join(code[:6]) + (f" (+{len(code) - 6})" if len(code) > 6 else "")

    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "Stop",
            "additionalContext": (
                f"[team-review] {len(code)} code file(s) changed this session and not yet "
                f"reviewed: {sample}. Suggested angles: {shown}. "
                f"Offer Sabry a review (the /team-review skill runs them in parallel and "
                f"adversarially verifies findings) — or say why it isn't warranted "
                f"(trivial/mechanical change). Do not review silently without telling him. "
                f"This reminder fires once per change-set; it is not a blocker."
            ),
        }
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
