#!/usr/bin/env python3
"""
Stop hook: "verify before you say it's done".

Reads this session's transcript. When a code file was edited and no test, typecheck,
lint or build command ran after the last edit, it returns feedback asking the agent
to run the project's checks for what it touched, or to say plainly which checks it
did not run and why. It names the project's own commands (package.json scripts,
Makefile targets) so the agent does not have to look for them.

Edits made through Bash (redirects, `tee`, `sed -i`, scripts that write a code file)
count as edits. A check is a command that runs a checker (`bun run test`, `tsc`,
`pytest`, ...), not one that only names a test file (`sed -n 1p a.test.ts`).

When Bash was refused this session, saying "not verified" does not silence it: a
refusal covers that command form only, so the agent is told to run the check as one
plain command.

Quiet when: nothing but docs/config changed, a check ran after the last edit, the
last reply already says what was not verified (and no Bash command was refused), the
same edit was already flagged, or `stop_hook_active` is set. It blocks the stop once
per change set; `stop_hook_active` and the change-set mark keep it from looping.

Switch: `"verify_reminder": false` or SABRY_KIT_VERIFY_REMINDER=0. Exit 0 on failure.
"""
import hashlib
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    import kit_config
except Exception:
    kit_config = None

CODE_EXT = (".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs", ".java", ".kt",
            ".cs", ".php", ".rb", ".swift", ".vue", ".svelte", ".dart", ".scala", ".sql")
EDIT_TOOLS = ("Write", "Edit", "MultiEdit", "NotebookEdit")
CHECKER = re.compile(
    r"^((bun|npm|pnpm|yarn)\s+(run\s+)?[\w:-]*(test|typecheck|type-check|lint|build|check|verify)[\w:-]*|"
    r"bun\s+test|(npx|bunx|pnpm\s+exec)\s+(tsc|vitest|jest|eslint|biome|playwright|mocha)|"
    r"tsc|vitest|jest|pytest|mocha|eslint|biome|ruff|mypy|pyright|phpunit|make\s+(test|lint|check|typecheck)|"
    r"python3?\s+-m\s+(pytest|unittest|mypy)|go\s+(test|vet|build)|cargo\s+(test|check|build|clippy)|"
    r"dotnet\s+(test|build))\b", re.I)
EXT = "|".join(e.lstrip(".") for e in CODE_EXT)
BASH_WRITE = re.compile(
    r"(>>?|\btee\s+(-a\s+)?)\s*['\"]?[^\s'\"<>|;&]+\.(" + EXT + r")\b|\bsed\s+(-\w*\s+)*-i|"
    r"\bperl\s+-\w*i|open\([^)]*['\"][wa]\+?['\"]|\.write_text\(|writeFileSync|Bun\.write", re.I)
CODE_PATH = re.compile(r"[^\s'\"<>|;&]+\.(" + EXT + r")\b", re.I)
REFUSED = re.compile(r"Permission to use Bash has been denied|has been denied because", re.I)
ADMITTED = re.compile(r"(ما\s*اتحقق|ماتحقق|لم\s*(أ|ا)تحقق|ما\s*شغّلت|ما\s*اتشغل|not\s+verified|didn'?t\s+(run|verify|test)|"
                      r"could\s*n[o']t\s+(run|verify|test)|untested)", re.I)


def is_check(command):
    for part in re.split(r"&&|\|\||[;|\n]", command):
        part = re.sub(r"^\s*((\w+=\S*|cd\s+\S+|timeout\s+\d+\w?)\s+)*", "", part.strip())
        if CHECKER.match(part):
            return True
    return False


def bash_writes(command):
    return [m.group(0) for m in CODE_PATH.finditer(command)] if BASH_WRITE.search(command) else []


def edits_and_checks(transcript):
    last_edit, last_check, files, refused = -1, -1, [], False
    bash, before = set(), {}
    with open(transcript, encoding="utf-8") as fh:
        for i, line in enumerate(fh):
            try:
                d = json.loads(line)
            except Exception:
                continue
            message = d.get("message") if isinstance(d, dict) else None
            content = message.get("content") if isinstance(message, dict) else None
            if not isinstance(content, list):
                continue
            for c in content:
                if not isinstance(c, dict):
                    continue
                if d.get("type") == "user" and c.get("type") == "tool_result" and c.get("tool_use_id") in bash:
                    text = c.get("content") if isinstance(c.get("content"), str) else json.dumps(c.get("content"))
                    if REFUSED.search(text or ""):
                        refused = True
                        last_check = before.get(c.get("tool_use_id"), last_check)
                    continue
                if d.get("type") != "assistant" or c.get("type") != "tool_use":
                    continue
                name, inp = c.get("name"), c.get("input") or {}
                if name in EDIT_TOOLS:
                    path = str(inp.get("file_path") or inp.get("notebook_path") or "")
                    if path.lower().endswith(CODE_EXT):
                        last_edit = i
                        files.append(path)
                elif name == "Bash":
                    bash.add(c.get("id"))
                    command = str(inp.get("command") or "")
                    written = bash_writes(command)
                    if written:
                        last_edit = i
                        files += written
                    if is_check(command):
                        before[c.get("id")] = last_check
                        last_check = i
    return last_edit, last_check, files, refused


def project_checks(root):
    found = []
    pkg = os.path.join(root, "package.json")
    if os.path.isfile(pkg):
        try:
            scripts = json.load(open(pkg, encoding="utf-8")).get("scripts") or {}
        except Exception:
            scripts = {}
        runner = "bun run" if os.path.isfile(os.path.join(root, "bun.lockb")) or os.path.isfile(os.path.join(root, "bun.lock")) else "npm run"
        found += [f"{runner} {k}" for k in scripts if re.search(r"test|typecheck|type-check|lint|check", k)]
    for name, cmd in (("go.mod", "go test ./..."), ("Cargo.toml", "cargo test"), ("pyproject.toml", "pytest")):
        if os.path.isfile(os.path.join(root, name)):
            found.append(cmd)
    mk = os.path.join(root, "Makefile")
    if os.path.isfile(mk):
        try:
            targets = re.findall(r"^(test|lint|check|typecheck)\s*:", open(mk, encoding="utf-8").read(), re.M)
            found += [f"make {t}" for t in targets]
        except OSError:
            pass
    return found[:6]


def state_path(session):
    safe = re.sub(r"[^A-Za-z0-9_-]", "", str(session or "x"))[:64]
    return os.path.join(os.path.expanduser("~"), ".agents", "state", f"verify-{safe}")


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return 0
    if not isinstance(payload, dict) or payload.get("stop_hook_active"):
        return 0
    root = kit_config.project_root(payload.get("cwd")) if kit_config else (payload.get("cwd") or os.getcwd())
    if kit_config and not kit_config.enabled("verify_reminder", root):
        return 0
    transcript = os.path.expanduser(str(payload.get("transcript_path") or ""))
    if not os.path.isfile(transcript):
        return 0
    last_edit, last_check, files, refused = edits_and_checks(transcript)
    if last_edit < 0 or last_check > last_edit:
        return 0
    if not refused and ADMITTED.search(str(payload.get("last_assistant_message") or "")):
        return 0
    key = hashlib.sha1(json.dumps(sorted(set(files))).encode() + str(last_edit).encode()).hexdigest()
    mark = state_path(payload.get("session_id"))
    try:
        if open(mark).read().strip() == key:
            return 0
    except OSError:
        pass
    try:
        os.makedirs(os.path.dirname(mark), exist_ok=True)
        with open(mark, "w") as fh:
            fh.write(key)
    except OSError:
        pass
    touched = sorted(set(os.path.relpath(f, root) if root and os.path.isabs(f) else f for f in files))
    checks = project_checks(root) if root else []
    msg = ("[verify-reminder] Code changed this session and no test, typecheck, lint or build ran after the last edit.\n"
           f"Touched: {', '.join(touched[:8])}{' …' if len(touched) > 8 else ''}\n"
           + (f"This project's checks: {' · '.join(checks)}\n" if checks else "")
           + ("A refused Bash command refuses that form only (a heredoc, a compound command, a script), not Bash. "
              "Run each check as one plain command, for example `" + (checks[0] if checks else "bun run test") + "`.\n"
              if refused else "")
           + "Before calling it done, run the checks that cover these files. If one cannot run, say plainly which "
             "and why (reply in the owner's language).")
    print(json.dumps({"decision": "block", "reason": msg}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        sys.exit(0)
