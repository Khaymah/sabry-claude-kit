#!/usr/bin/env python3
"""
Stop hook: "verify before you say it's done".

Reads this session's transcript. When a code file was edited and no test, typecheck,
lint or build command ran after the last edit, it returns feedback asking the agent
to run the project's checks for what it touched, or to say plainly which checks it
did not run and why. It names the project's own commands (package.json scripts,
Makefile targets) so the agent does not have to look for them.

Quiet when: nothing but docs/config changed, a check ran after the last edit, the
last reply already says what was not verified, the same edit was already flagged,
or `stop_hook_active` is set. Uses additionalContext (feedback, not an error), so it
can never loop past Claude Code's own continuation cap.

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
CHECK = re.compile(
    r"\b(test|tests|vitest|jest|pytest|mocha|playwright|tsc|typecheck|type-check|lint|eslint|biome|"
    r"ruff|mypy|pyright|go\s+(test|vet|build)|cargo\s+(test|check|build|clippy)|dotnet\s+(test|build)|"
    r"phpunit|build|check|verify)\b", re.I)
ADMITTED = re.compile(r"(ما\s*اتحقق|ماتحقق|لم\s*(أ|ا)تحقق|ما\s*شغّلت|ما\s*اتشغل|not\s+verified|didn'?t\s+(run|verify|test)|"
                      r"could\s*n[o']t\s+(run|verify|test)|untested)", re.I)


def edits_and_checks(transcript):
    last_edit, last_check, files = -1, -1, []
    tools = {}
    with open(transcript, encoding="utf-8") as fh:
        for i, line in enumerate(fh):
            try:
                d = json.loads(line)
            except Exception:
                continue
            if d.get("type") != "assistant":
                continue
            for c in (d.get("message") or {}).get("content") or []:
                if not isinstance(c, dict) or c.get("type") != "tool_use":
                    continue
                name, inp = c.get("name"), c.get("input") or {}
                if name in EDIT_TOOLS:
                    path = str(inp.get("file_path") or inp.get("notebook_path") or "")
                    if path.lower().endswith(CODE_EXT):
                        last_edit = i
                        files.append(path)
                elif name == "Bash" and CHECK.search(str(inp.get("command") or "")):
                    last_check = i
    return last_edit, last_check, files


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
    last_edit, last_check, files = edits_and_checks(transcript)
    if last_edit < 0 or last_check > last_edit:
        return 0
    if ADMITTED.search(str(payload.get("last_assistant_message") or "")):
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
           + "Before calling it done, run the checks that cover these files. If you can't, say plainly which "
             "checks you did not run and why (reply in the owner's language).")
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "Stop", "additionalContext": msg}}))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        sys.exit(0)
