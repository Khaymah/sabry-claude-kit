"""Behavioural tests for project-storage.py, each against a throwaway HOME and repo."""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
HOOK = os.path.join(HERE, "project-storage.py")
FAILED = []


def check(label, ok, detail=""):
    print(f"  {'PASS' if ok else 'FAIL'} {label}" + ("" if ok else f"  -> {detail}"))
    if not ok:
        FAILED.append(label)


def git(repo, *args):
    return subprocess.run(["git", "-C", repo] + list(args), capture_output=True, text=True)


def sandbox():
    base = tempfile.mkdtemp()
    home = os.path.join(base, "home")
    repo = os.path.join(base, "work", "proj")
    os.makedirs(home)
    os.makedirs(repo)
    git(repo, "init", "-q", "-b", "main")
    git(repo, "config", "user.email", "t@t.t")
    git(repo, "config", "user.name", "t")
    env = dict(os.environ, HOME=home, USERPROFILE=home)
    for k in ("CLAUDE_CONFIG_DIR", "CLAUDE_PROJECT_DIR", "SABRY_KIT_PROFILE"):
        env.pop(k, None)
    env = {k: v for k, v in env.items() if not k.startswith("SABRY_KIT_")}
    return base, home, repo, env


def run(env, payload, args=()):
    p = subprocess.run([sys.executable, HOOK] + list(args), input=json.dumps(payload),
                       capture_output=True, text=True, env=env, timeout=60)
    return p.returncode, p.stdout.strip()


def main():
    base, home, repo, env = sandbox()
    try:
        store = os.path.join(repo, ".agents")
        os.makedirs(os.path.join(repo, ".claude", "agent-memory", "cto"))
        with open(os.path.join(repo, ".claude", "agent-memory", "cto", "MEMORY.md"), "w") as fh:
            fh.write("- old cto note\n")
        with open(os.path.join(repo, ".claude", "settings.local.json"), "w") as fh:
            json.dump({"permissions": {"allow": ["Bash(ls)"]}}, fh)
        slug = re.sub(r"[^A-Za-z0-9]", "-", os.path.realpath(repo))
        legacy = os.path.join(home, ".claude", "projects", slug, "memory")
        os.makedirs(legacy)
        with open(os.path.join(legacy, "MEMORY.md"), "w") as fh:
            fh.write("- legacy auto memory\n")

        print("first session")
        rc, out = run(env, {"cwd": repo})
        check("exit 0", rc == 0)
        check("reports what it did", "[project-storage]" in out, out)
        for d in ("memory", "agent-memory", "plans", "scratch", "sessions"):
            check(f".agents/{d} exists", os.path.isdir(os.path.join(store, d)))
        gi = open(os.path.join(store, ".gitignore")).read()
        check(".agents/.gitignore ignores scratch + sessions", "scratch/" in gi and "sessions/" in gi)

        s = json.load(open(os.path.join(repo, ".claude", "settings.local.json")))
        mem = s.get("autoMemoryDirectory", "")
        check("autoMemoryDirectory is absolute and inside the project",
              os.path.isabs(mem) and os.path.realpath(mem) == os.path.realpath(os.path.join(store, "memory")), mem)
        check("plansDirectory relative to project", s.get("plansDirectory") == "./.agents/plans", s)
        check("existing settings keys kept", s.get("permissions") == {"allow": ["Bash(ls)"]}, s)

        link = os.path.join(repo, ".claude", "agent-memory")
        check(".claude/agent-memory is a link", os.path.islink(link))
        moved = os.path.join(store, "agent-memory", "cto", "MEMORY.md")
        check("old agent memory moved, not lost", os.path.isfile(moved) and "old cto note" in open(moved).read())
        check("reachable through the link", os.path.isfile(os.path.join(link, "cto", "MEMORY.md")))

        imported = os.path.join(store, "memory", "MEMORY.md")
        check("legacy auto memory copied", os.path.isfile(imported) and "legacy" in open(imported).read())
        check("legacy original kept", os.path.isfile(os.path.join(legacy, "MEMORY.md")))

        exclude = open(os.path.join(repo, ".git", "info", "exclude")).read()
        check("link + local settings excluded locally",
              "/.claude/agent-memory" in exclude and "/.claude/settings.local.json" in exclude, exclude)
        pre = os.path.join(repo, ".git", "hooks", "pre-commit")
        check("pre-commit installed", os.path.isfile(pre) and os.access(pre, os.X_OK))
        check("scanner copied next to it", os.path.isfile(os.path.join(repo, ".git", "hooks", "sabry-kit-scan-secrets.py")))

        status = git(repo, "status", "--porcelain", "--untracked-files=all").stdout
        check("git sees .agents/ content, not the link or local settings",
              ".agents/" in status and ".claude/agent-memory" not in status
              and "settings.local.json" not in status, status)

        print("second session")
        rc, out = run(env, {"cwd": repo})
        check("idempotent: silent", rc == 0 and out == "", out)
        check("exclude block not duplicated",
              open(os.path.join(repo, ".git", "info", "exclude")).read().count("# >>> sabry-kit") == 1)

        print("pre-commit in action")
        git(repo, "add", "-A")
        ok = git(repo, "commit", "-q", "-m", "chore: seed")
        check("clean commit passes", ok.returncode == 0, ok.stderr)
        with open(os.path.join(store, "memory", "leak.md"), "w") as fh:
            fh.write("db: " + "postgres://app:" + "S3cr3tPassw0rd" + "@prod/db\n")
        git(repo, "add", "-A")
        bad = git(repo, "commit", "-q", "-m", "chore: leak")
        check("commit with a secret in memory blocked", bad.returncode != 0 and "agent memory" in bad.stderr, bad.stderr)

        print("respects the repo's own hooks")
        base2, home2, repo2, env2 = sandbox()
        try:
            os.makedirs(os.path.join(repo2, ".git", "hooks"), exist_ok=True)
            with open(os.path.join(repo2, ".git", "hooks", "pre-commit"), "w") as fh:
                fh.write("#!/bin/sh\necho mine\n")
            run(env2, {"cwd": repo2})
            check("foreign pre-commit untouched", "mine" in open(os.path.join(repo2, ".git", "hooks", "pre-commit")).read())
            git(repo2, "config", "core.hooksPath", ".husky")
            os.remove(os.path.join(repo2, ".git", "hooks", "pre-commit"))
            run(env2, {"cwd": repo2})
            check("core.hooksPath set → not installed", not os.path.exists(os.path.join(repo2, ".git", "hooks", "pre-commit")))
        finally:
            shutil.rmtree(base2, ignore_errors=True)

        print("switches and edges")
        base3, home3, repo3, env3 = sandbox()
        try:
            rc, out = run(dict(env3, SABRY_KIT_PROJECT_STORAGE="0"), {"cwd": repo3})
            check("SABRY_KIT_PROJECT_STORAGE=0 → nothing", out == "" and not os.path.exists(os.path.join(repo3, ".agents")))
            os.makedirs(os.path.join(home3, ".agents"))
            with open(os.path.join(home3, ".agents", "profile.json"), "w") as fh:
                json.dump({"settings": {"project_storage": False}}, fh)
            run(env3, {"cwd": repo3})
            check("profile project_storage=false → nothing", not os.path.exists(os.path.join(repo3, ".agents")))
            rc, out = run(env3, {"cwd": home3})
            check("home directory → never touched", not os.path.exists(os.path.join(home3, ".agents", "memory")))
        finally:
            shutil.rmtree(base3, ignore_errors=True)

        transcript = os.path.join(base, "t.jsonl")
        with open(transcript, "w") as fh:
            fh.write('{"type":"user"}\n')
        run(env, {"cwd": repo, "session_id": "abc-123", "transcript_path": transcript}, args=("--save-transcript",))
        check("SessionEnd copies transcript", os.path.isfile(os.path.join(store, "sessions", "abc-123.jsonl")))

        rc, out = subprocess.run([sys.executable, HOOK], input="garbage", capture_output=True, text=True,
                                 env=env, cwd=repo, timeout=60).returncode, ""
        check("malformed payload → exit 0", rc == 0)
    finally:
        shutil.rmtree(base, ignore_errors=True)

    print(f"\n{len(FAILED)} FAILED" + (": " + "; ".join(FAILED) if FAILED else ""))
    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main())
