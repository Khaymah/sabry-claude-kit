#!/usr/bin/env python3
"""
SessionStart hook - keeps every project's agent state inside the project, under .agents/.

    .agents/
      memory/        Claude Code auto memory (autoMemoryDirectory)        committed
      agent-memory/  subagent memory; .claude/agent-memory links here      committed
      plans/         plan-mode files (plansDirectory)                      committed
      scratch/       temporary files instead of /tmp or the scratchpad     ignored
      sessions/      copies of session transcripts (SessionEnd)            ignored

The project then carries its own memory, independent of the machine, the plugin
version and the agent: uninstall the kit and nothing is lost.

What it does, idempotently, every session start:
  1. Creates the folders above and .agents/.gitignore (scratch/ and sessions/).
  2. Writes autoMemoryDirectory (absolute: Claude Code accepts nothing else) and
     plansDirectory into .claude/settings.local.json, keeping every other key.
  3. Links .claude/agent-memory -> .agents/agent-memory (symlink, or a junction on
     Windows, which needs no admin rights). A real .claude/agent-memory directory is
     moved in first, never overwritten: a name clash keeps both files.
  4. Copies the old ~/.claude/projects/<slug>/memory/ into .agents/memory/ once, when
     .agents/memory/ has no MEMORY.md yet. Copy, not move: the original stays.
  5. Adds the machine-specific bits (the link, settings.local.json) to
     .git/info/exclude, so no tracked project file is edited.
  6. Installs the secret-scanning git pre-commit hook (scan-secrets.py) when the repo
     has no pre-commit hook of its own and no core.hooksPath.

With `SessionEnd` and `--save-transcript` it copies the transcript into
.agents/sessions/ instead.

Cloud sessions (CLAUDE_CODE_REMOTE) ignore `.claude/settings.local.json` and start from
a fresh container, so the settings above do not apply there. Two more steps keep memory
in the project anyway: SessionStart copies .agents/memory to where Claude Code reads
memory by default, and `--collect` (Stop, SessionEnd) copies anything new back into
.agents/memory and, in the cloud, plans from ~/.claude/plans into .agents/plans. In a
cloud Stop it also reminds, once per change-set, that .agents/ must be committed and
pushed before the container is deleted.

Off switch: `"project_storage": false` in a profile, or SABRY_KIT_PROJECT_STORAGE=0.
Silent and exit-0 on any failure.
"""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit_config

HOOKS = os.path.dirname(os.path.abspath(__file__))
COMMITTED = ("memory", "agent-memory", "plans")
IGNORED = ("scratch", "sessions")
GITIGNORE = "# Managed by sabry-kit: machine-local, never committed.\nscratch/\nsessions/\n"
EXCLUDE_BLOCK = ("# >>> sabry-kit", "/.claude/agent-memory", "/.claude/settings.local.json",
                 "# <<< sabry-kit")
PRE_COMMIT = """#!/bin/sh
# Installed by sabry-kit: blocks commits that add secrets. Bypass once: git commit --no-verify
PY="$(command -v python3 || command -v python)"
[ -z "$PY" ] && exit 0
exec "$PY" "$(dirname "$0")/sabry-kit-scan-secrets.py" --git-pre-commit
"""
PRE_COMMIT_MARK = "Installed by sabry-kit"


def write_if_changed(path, text):
    try:
        with open(path, encoding="utf-8") as fh:
            if fh.read() == text:
                return False
    except OSError:
        pass
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)
    return True


def ensure_dirs(store):
    for name in COMMITTED + IGNORED:
        os.makedirs(os.path.join(store, name), exist_ok=True)
    for name in COMMITTED:
        keep = os.path.join(store, name, ".gitkeep")
        if not os.listdir(os.path.join(store, name)):
            open(keep, "a").close()
    write_if_changed(os.path.join(store, ".gitignore"), GITIGNORE)


def update_local_settings(root, store):
    path = os.path.join(root, ".claude", "settings.local.json")
    data = {}
    if os.path.isfile(path):
        try:
            with open(path, encoding="utf-8") as fh:
                data = json.load(fh)
        except Exception:
            return False
        if not isinstance(data, dict):
            return False
    want = {
        "autoMemoryDirectory": os.path.join(store, "memory").replace("\\", "/"),
        "plansDirectory": "./" + kit_config.STORAGE_DIR + "/plans",
    }
    if all(data.get(k) == v for k, v in want.items()):
        return False
    data.update(want)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    write_if_changed(path, json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    return True


def unique_target(dst):
    if not os.path.exists(dst):
        return dst
    base, ext = os.path.splitext(dst)
    n = 2
    while os.path.exists(f"{base}.{n}{ext}"):
        n += 1
    return f"{base}.{n}{ext}"


def merge_move(src, dst):
    """Move src's tree into dst. Identical files are dropped, clashes kept side by side."""
    for dirpath, _, files in os.walk(src):
        rel = os.path.relpath(dirpath, src)
        target_dir = os.path.normpath(os.path.join(dst, rel))
        os.makedirs(target_dir, exist_ok=True)
        for fn in files:
            s, d = os.path.join(dirpath, fn), os.path.join(target_dir, fn)
            if os.path.isfile(d) and same_file(s, d):
                os.remove(s)
                continue
            shutil.move(s, unique_target(d))
    shutil.rmtree(src, ignore_errors=True)


def same_file(a, b):
    def digest(p):
        with open(p, "rb") as fh:
            return hashlib.sha256(fh.read()).hexdigest()
    try:
        return digest(a) == digest(b)
    except OSError:
        return False


def is_link(path):
    if os.path.islink(path):
        return True
    if sys.platform == "win32":
        try:
            return bool(os.readlink(path))
        except (OSError, ValueError, AttributeError):
            return False
    return False


def make_link(link, target):
    try:
        os.symlink(target, link, target_is_directory=True)
        return True
    except (OSError, NotImplementedError):
        pass
    if sys.platform == "win32":
        try:
            import _winapi
            _winapi.CreateJunction(os.path.abspath(target), link)
            return True
        except Exception:
            return False
    return False


def link_agent_memory(root, store):
    """Returns a note when it changed something, else None."""
    claude_dir = os.path.join(root, ".claude")
    link = os.path.join(claude_dir, "agent-memory")
    target = os.path.join(store, "agent-memory")
    if is_link(link):
        return None
    note = None
    if os.path.isdir(link):
        merge_move(link, target)
        note = "moved .claude/agent-memory into .agents/agent-memory"
    elif os.path.exists(link):
        return None
    os.makedirs(claude_dir, exist_ok=True)
    rel = os.path.relpath(target, claude_dir)
    if make_link(link, rel if sys.platform != "win32" else target):
        return note or "linked .claude/agent-memory to .agents/agent-memory"
    return note


def legacy_memory_dir(root):
    config = os.environ.get("CLAUDE_CONFIG_DIR") or os.path.join(kit_config.home(), ".claude")
    slug = re.sub(r"[^A-Za-z0-9]", "-", root)
    return os.path.join(config, "projects", slug, "memory")


def import_legacy_memory(root, store):
    dst = os.path.join(store, "memory")
    if os.path.isfile(os.path.join(dst, "MEMORY.md")):
        return None
    src = legacy_memory_dir(root)
    if not os.path.isdir(src) or not os.listdir(src):
        return None
    for dirpath, _, files in os.walk(src):
        rel = os.path.relpath(dirpath, src)
        os.makedirs(os.path.join(dst, rel), exist_ok=True)
        for fn in files:
            d = os.path.join(dst, rel, fn)
            if not os.path.exists(d):
                shutil.copy2(os.path.join(dirpath, fn), d)
    return "copied existing auto memory into .agents/memory (original kept)"



def seed_memory(root, store):
    """Copy committed project memory to where Claude Code reads it when the
    autoMemoryDirectory setting is not honoured (cloud sessions ignore local settings;
    locally the first session after setup still uses the old location)."""
    n = mirror(os.path.join(store, "memory"), legacy_memory_dir(root))
    return f"loaded {n} project memory file(s) from .agents/memory" if n and is_cloud() else None


def git_dir(root):
    try:
        p = subprocess.run(["git", "-C", root, "rev-parse", "--absolute-git-dir"],
                           capture_output=True, text=True, timeout=5)
        return p.stdout.strip() if p.returncode == 0 else None
    except Exception:
        return None


def update_exclude(gdir):
    path = os.path.join(gdir, "info", "exclude")
    try:
        text = open(path, encoding="utf-8").read() if os.path.isfile(path) else ""
    except OSError:
        return
    if EXCLUDE_BLOCK[0] in text:
        return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "a", encoding="utf-8", newline="\n") as fh:
        if text and not text.endswith("\n"):
            fh.write("\n")
        fh.write("\n".join(EXCLUDE_BLOCK) + "\n")


def install_pre_commit(root, gdir):
    try:
        p = subprocess.run(["git", "-C", root, "config", "--get", "core.hooksPath"],
                           capture_output=True, text=True, timeout=5)
        if p.stdout.strip():
            return None
    except Exception:
        return None
    hooks_dir = os.path.join(gdir, "hooks")
    hook = os.path.join(hooks_dir, "pre-commit")
    if os.path.isfile(hook):
        try:
            if PRE_COMMIT_MARK not in open(hook, encoding="utf-8", errors="replace").read():
                return None
        except OSError:
            return None
    os.makedirs(hooks_dir, exist_ok=True)
    src = open(os.path.join(HOOKS, "scan-secrets.py"), encoding="utf-8").read()
    changed = write_if_changed(os.path.join(hooks_dir, "sabry-kit-scan-secrets.py"), src)
    fresh = write_if_changed(hook, PRE_COMMIT)
    os.chmod(hook, 0o755)
    return "installed the secret-scanning git pre-commit hook" if fresh else (
        "updated the secret scanner in .git/hooks" if changed else None)


def save_transcript(payload, store):
    src = payload.get("transcript_path")
    if not src or not os.path.isfile(src):
        return
    sid = re.sub(r"[^A-Za-z0-9_-]", "", str(payload.get("session_id") or "session"))[:64]
    dst_dir = os.path.join(store, "sessions")
    os.makedirs(dst_dir, exist_ok=True)
    shutil.copy2(src, os.path.join(dst_dir, sid + os.path.splitext(src)[1]))



def is_cloud():
    return bool(os.environ.get("CLAUDE_CODE_REMOTE"))


def mirror(src, dst):
    """Copy files from src into dst when missing there or newer in src. Returns the count."""
    if not os.path.isdir(src):
        return 0
    n = 0
    for dirpath, _, files in os.walk(src):
        rel = os.path.relpath(dirpath, src)
        for fn in files:
            if fn == ".gitkeep":
                continue
            s_path = os.path.join(dirpath, fn)
            d_path = os.path.normpath(os.path.join(dst, rel, fn))
            if os.path.isfile(d_path) and os.path.getmtime(d_path) >= os.path.getmtime(s_path) - 1:
                continue
            os.makedirs(os.path.dirname(d_path), exist_ok=True)
            shutil.copy2(s_path, d_path)
            n += 1
    return n


def marker_path(store):
    return os.path.join(store, "scratch", "session-start.json")


def write_marker(store, mirroring):
    """When this session started, and whether memory must be mirrored: only when the
    autoMemoryDirectory setting is not in effect (cloud, or the first local session),
    so a memory deleted on purpose is never copied back from the old location."""
    import time
    try:
        with open(marker_path(store), "w") as fh:
            json.dump({"t": time.time(), "mirror": bool(mirroring)}, fh)
    except OSError:
        pass


def read_marker(store):
    try:
        with open(marker_path(store)) as fh:
            data = json.load(fh)
        return float(data.get("t", 0)), bool(data.get("mirror"))
    except Exception:
        return 0.0, is_cloud()


def collect_plans(store):
    """Cloud only: plan-mode files written to ~/.claude/plans this session (plansDirectory in
    local settings is ignored there) move into .agents/plans."""
    config = os.environ.get("CLAUDE_CONFIG_DIR") or os.path.join(kit_config.home(), ".claude")
    src = os.path.join(config, "plans")
    since, _ = read_marker(store)
    if not since:
        return 0
    n = 0
    for f in os.listdir(src) if os.path.isdir(src) else []:
        path = os.path.join(src, f)
        if os.path.isfile(path) and os.path.getmtime(path) >= since:
            dst = os.path.join(store, "plans", f)
            if not os.path.isfile(dst) or os.path.getmtime(dst) < os.path.getmtime(path):
                shutil.copy2(path, dst)
                n += 1
    return n


def uncommitted(root):
    try:
        p = subprocess.run(["git", "-C", root, "status", "--porcelain", "--", kit_config.STORAGE_DIR],
                           capture_output=True, text=True, timeout=10)
        return [l for l in p.stdout.splitlines() if l.strip()] if p.returncode == 0 else []
    except Exception:
        return []


def collect(payload, root, store):
    """Stop / SessionEnd: bring memory and plans back into .agents/, and in a cloud session
    remind once per change-set that .agents/ must be committed and pushed before the
    container is deleted."""
    _, mirroring = read_marker(store)
    if mirroring:
        mirror(legacy_memory_dir(root), os.path.join(store, "memory"))
    if is_cloud():
        collect_plans(store)
    if payload.get("hook_event_name") != "Stop" or not is_cloud() or payload.get("stop_hook_active"):
        return None
    changes = uncommitted(root)
    if not changes:
        return None
    key = hashlib.sha1("\n".join(changes).encode()).hexdigest()
    state = os.path.join(store, "scratch", "commit-reminder")
    try:
        if open(state).read().strip() == key:
            return None
    except OSError:
        pass
    with open(state, "w") as fh:
        fh.write(key)
    files = ", ".join(l[3:] for l in changes[:6]) + (" …" if len(changes) > 6 else "")
    return ("[project-storage] Cloud session: project memory in .agents/ has uncommitted changes "
            f"({len(changes)}: {files}). This container is deleted when the session ends, so commit "
            "them with your work (`git add .agents`, an English message) and push. Do it only if the "
            "owner's work in this session is being committed anyway; never push to a branch the owner did not ask for.")


def main():
    args = sys.argv[1:]
    try:
        payload = json.load(sys.stdin)
        if not isinstance(payload, dict):
            payload = {}
    except Exception:
        payload = {}

    root = kit_config.project_root(payload.get("cwd"))
    if not root or not kit_config.enabled("project_storage", root):
        return 0
    store = os.path.join(root, kit_config.STORAGE_DIR)

    if "--save-transcript" in args:
        if kit_config.enabled("keep_transcripts", root):
            save_transcript(payload, store)
        return 0

    if "--collect" in args:
        msg = collect(payload, root, store)
        if msg:
            print(json.dumps({"hookSpecificOutput": {"hookEventName": "Stop", "additionalContext": msg}}))
        return 0

    notes = []
    ensure_dirs(store)
    just_set = update_local_settings(root, store)
    if just_set and not is_cloud():
        notes.append("pointed auto memory and plans at .agents/ (takes effect next session)")
    write_marker(store, mirroring=is_cloud() or just_set)
    steps = [link_agent_memory, import_legacy_memory]
    if is_cloud() or just_set:
        steps.append(seed_memory)
    for step in steps:
        try:
            n = step(root, store)
            if n:
                notes.append(n)
        except Exception:
            pass
    gdir = git_dir(root)
    if gdir:
        update_exclude(gdir)
        if kit_config.enabled("secret_scan", root) and kit_config.enabled("install_git_hook", root):
            try:
                n = install_pre_commit(root, gdir)
                if n:
                    notes.append(n)
            except Exception:
                pass

    if notes:
        print(json.dumps({"systemMessage": "[project-storage] " + "; ".join(notes)}))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        sys.exit(0)
