#!/usr/bin/env python3
"""
Secret scanner for commits: stops keys, tokens, private keys and .env files before
they reach git history, where removing them means rewriting history.

Matters more with per-project memory: .agents/memory and .agents/agent-memory are
committed, and an agent can paste a credential into a note without anyone noticing.

Three ways to run, same rules:

    git pre-commit   scan-secrets.py --git-pre-commit      (installed by project-storage;
                     works for any agent and for humans; exit 1 blocks the commit)
    Claude hook      PreToolUse on Bash: when the command is a `git commit`, scans what
                     that commit would contain and denies with the findings
    manual / CI      scan-secrets.py [--staged | --all-tracked | PATH...]

Only added lines are scanned in a diff, so an old secret already in history does not
block every later commit (use --all-tracked to audit those).

False positive? Put `allow-secret` (or `pragma: allowlist secret`) on that line, or a
regex per line in .agents/secrets-allowlist. Values are masked in every message.
Bypass once on purpose: git commit --no-verify.

Stdlib only, so it can be copied into .git/hooks and run without the kit installed.
"""
import json
import math
import os
import re
import subprocess
import sys

RULES = [
    ("Private key", re.compile(r"-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----")),
    ("AWS access key", re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b")),
    ("AWS secret key", re.compile(r"(?i)aws_?secret_?access_?key\s*[=:]\s*['\"]?([A-Za-z0-9/+=]{40})")),
    ("GitHub token", re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b")),
    ("GitLab token", re.compile(r"\bglpat-[A-Za-z0-9_-]{20,}\b")),
    ("Anthropic API key", re.compile(r"\bsk-ant-[A-Za-z0-9_-]{20,}")),
    ("OpenAI API key", re.compile(r"\bsk-(?:proj-|svcacct-)?(?!ant-)[A-Za-z0-9_-]{32,}")),
    ("Google API key", re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b")),
    ("Slack token", re.compile(r"\bxox[abposr]-[A-Za-z0-9-]{10,}")),
    ("Slack webhook", re.compile(r"https://hooks\.slack\.com/services/[A-Za-z0-9/]{20,}")),
    ("Stripe live key", re.compile(r"\b(?:sk|rk)_live_[A-Za-z0-9]{20,}")),
    ("Twilio key", re.compile(r"\bSK[0-9a-f]{32}\b")),
    ("SendGrid key", re.compile(r"\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b")),
    ("npm token", re.compile(r"\bnpm_[A-Za-z0-9]{36}\b")),
    ("JWT", re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}")),
    ("Password in URL", re.compile(r"\b[a-z][a-z0-9+.-]*://[^/\s:@'\"]+:([^/\s:@'\"]{6,})@[^\s'\"]+")),
]

ASSIGNMENT = re.compile(
    r"(?i)\b([\w.-]*(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?key|auth[_-]?token|"
    r"token|private[_-]?key|client[_-]?secret)[\w.-]*)\s*[:=]\s*['\"]([^'\"\s]{12,})['\"]")

PLACEHOLDER = re.compile(
    r"(?i)(x{4,}|\*{3,}|<[^>]*>|\$\{|\{\{|process\.env|os\.environ|getenv|example|sample|"
    r"dummy|placeholder|changeme|change_me|your[_-]|redacted|test|fake|secret_here|"
    r"password123|^\.+$)")

SENSITIVE_FILE = re.compile(
    r"(?i)(^|/)(\.env(\.[\w-]+)?|id_(rsa|dsa|ecdsa|ed25519)|[^/]+\.(pem|p12|pfx|key|keystore|jks)|"
    r"credentials\.json|\.npmrc|\.pypirc|\.netrc)$")
SAFE_FILE = re.compile(r"(?i)\.(example|sample|template|dist|defaults?)$|\.pub$|(^|/)\.env\.(example|sample|template)$")

ALLOW_INLINE = ("allow-secret", "pragma: allowlist secret")


def entropy(s):
    if not s:
        return 0.0
    counts = {c: s.count(c) for c in set(s)}
    return -sum(n / len(s) * math.log2(n / len(s)) for n in counts.values())


def mask(value):
    value = value.strip()
    return (value[:4] + "…" + "*" * 6) if len(value) > 8 else "*" * 6


def load_allowlist(root):
    path = os.path.join(root or ".", ".agents", "secrets-allowlist")
    pats = []
    try:
        for line in open(path, encoding="utf-8"):
            line = line.strip()
            if line and not line.startswith("#"):
                try:
                    pats.append(re.compile(line))
                except re.error:
                    pass
    except OSError:
        pass
    return pats


def scan_line(line):
    if any(tag in line for tag in ALLOW_INLINE):
        return []
    hits = []
    for name, rx in RULES:
        m = rx.search(line)
        if m:
            value = m.group(1) if m.groups() and m.group(1) else m.group(0)
            if name == "Password in URL" and PLACEHOLDER.search(value):
                continue
            hits.append((name, value))
    if not hits:
        m = ASSIGNMENT.search(line)
        if m:
            value = m.group(2)
            if not PLACEHOLDER.search(value) and entropy(value) >= 3.0:
                hits.append((f"Hard-coded {m.group(1)}", value))
    return hits


def scan_text(path, lines, allow):
    """lines: iterable of (line_number, text). Returns findings."""
    found = []
    for no, text in lines:
        for name, value in scan_line(text):
            if any(p.search(text) or p.search(value) for p in allow):
                continue
            found.append({"file": path, "line": no, "kind": name, "value": mask(value)})
    return found


def sensitive_file(path):
    p = path.replace("\\", "/")
    return bool(SENSITIVE_FILE.search(p)) and not SAFE_FILE.search(p)


def git(root, *args):
    p = subprocess.run(["git", "-C", root] + list(args), capture_output=True, timeout=30)
    return p.stdout.decode("utf-8", "replace") if p.returncode == 0 else ""


def added_lines(diff):
    """Parse a -U0 diff into {path: [(line_no, text)]} for added lines only."""
    out, path, no = {}, None, 0
    for raw in diff.splitlines():
        if raw.startswith("+++ "):
            target = raw[4:]
            path = None if target == "/dev/null" else re.sub(r"^b/", "", target)
            continue
        if raw.startswith("@@"):
            m = re.search(r"\+(\d+)", raw)
            no = int(m.group(1)) if m else 0
            continue
        if path and raw.startswith("+") and not raw.startswith("+++"):
            out.setdefault(path, []).append((no, raw[1:]))
            no += 1
    return out


def scan_diff(root, diff_args, names_args):
    allow = load_allowlist(root)
    findings = []
    for path in git(root, *names_args).splitlines():
        if path and sensitive_file(path):
            findings.append({"file": path, "line": 0, "kind": "Sensitive file", "value": "committed as a file"})
    for path, lines in added_lines(git(root, *diff_args)).items():
        findings.extend(scan_text(path, lines, allow))
    return findings


def scan_staged(root):
    return scan_diff(root, ("diff", "--cached", "-U0", "--no-color", "--no-ext-diff"),
                     ("diff", "--cached", "--name-only", "--diff-filter=AR"))


def scan_worktree(root):
    return scan_diff(root, ("diff", "HEAD", "-U0", "--no-color", "--no-ext-diff"),
                     ("diff", "HEAD", "--name-only", "--diff-filter=AR"))


def scan_paths(paths, root="."):
    allow = load_allowlist(root)
    findings = []
    for path in paths:
        if sensitive_file(path):
            findings.append({"file": path, "line": 0, "kind": "Sensitive file", "value": "present"})
        try:
            with open(path, encoding="utf-8", errors="replace") as fh:
                findings.extend(scan_text(path, enumerate(fh, 1), allow))
        except OSError:
            pass
    return findings


def report(findings, limit=20):
    lines = []
    for f in findings[:limit]:
        where = f"{f['file']}:{f['line']}" if f["line"] else f["file"]
        memory = "  ← agent memory (committed)" if "/.agents/" in "/" + f["file"] or f["file"].startswith(".agents/") else ""
        lines.append(f"  - {where}  {f['kind']}  {f['value']}{memory}")
    if len(findings) > limit:
        lines.append(f"  … and {len(findings) - limit} more")
    return "\n".join(lines)


HELP = ("Move the value to an environment variable or a secret manager and reference it, "
        "or add it to .gitignore. False positive: put `allow-secret` on the line or a regex in "
        ".agents/secrets-allowlist. Deliberate bypass: git commit --no-verify.")

COMMIT = re.compile(r"(^|[;&|]|\bthen\b|\bdo\b)\s*(?:\w+=\S+\s+)*git(?:\s+-C\s+\S+)?\s+commit\b")
ALL_FLAG = re.compile(r"\bcommit\b[^;&|]*\s(-a\b|--all\b|-[a-zA-Z]*a[a-zA-Z]*\b)")


def claude_hook(payload):
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    try:
        import kit_config
    except Exception:
        kit_config = None
    cmd = (payload.get("tool_input") or {}).get("command") or ""
    if not isinstance(cmd, str) or not COMMIT.search(cmd):
        return 0
    cwd = payload.get("cwd") or os.getcwd()
    root = git(cwd, "rev-parse", "--show-toplevel").strip()
    if not root:
        return 0
    if kit_config and not kit_config.enabled("secret_scan", root):
        return 0
    findings = scan_worktree(root) if ALL_FLAG.search(cmd) else scan_staged(root)
    if not findings:
        return 0
    reason = ("[scan-secrets] Blocked: this commit would add secrets to git history.\n"
              + report(findings) + "\n" + HELP)
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": reason,
    }}))
    return 0


def main():
    args = sys.argv[1:]
    if "--git-pre-commit" in args or "--staged" in args:
        root = git(".", "rev-parse", "--show-toplevel").strip() or "."
        findings = scan_staged(root)
        if findings:
            sys.stderr.write("✋ sabry-kit: commit blocked, possible secrets:\n" + report(findings) + "\n" + HELP + "\n")
            return 1
        return 0
    if "--all-tracked" in args:
        root = git(".", "rev-parse", "--show-toplevel").strip() or "."
        files = [os.path.join(root, p) for p in git(root, "ls-files").splitlines()]
        findings = scan_paths(files, root)
        print(report(findings, limit=200) or "clean")
        return 1 if findings else 0
    if args:
        findings = scan_paths(args)
        print(report(findings, limit=200) or "clean")
        return 1 if findings else 0
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return 0
    if not isinstance(payload, dict):
        return 0
    try:
        return claude_hook(payload)
    except Exception:
        return 0


if __name__ == "__main__":
    sys.exit(main())
