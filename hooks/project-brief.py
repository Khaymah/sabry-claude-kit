#!/usr/bin/env python3
"""
SessionStart hook: a compact, deterministic brief of the project, so the agent starts
knowing the stack, the exact check commands, the layout and where the last session
stopped, instead of spending the first turns exploring.

    # Project brief
    - repo · branch · uncommitted files · last commit
    - stack (from manifests, not guesses)
    - commands: test · typecheck · lint · build · dev (the project's own scripts)
    - layout: top-level code folders with file counts
    - memory: .agents/memory/MEMORY.md entries
    - continue from: the last "الجاي/Next" and "مفتوح/Open" lines in Plan/Progress/

No model call, capped at ~1.5KB, the layout cached in .agents/scratch/ by HEAD and
manifest mtimes. Switch: `"project_brief": false` or SABRY_KIT_PROJECT_BRIEF=0.
Exit 0 with no output on any failure or outside a project.
"""
import glob
import json
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit_config

MAX_CHARS = 1500
SKIP = {"node_modules", ".git", "dist", "build", ".next", "out", "coverage", ".turbo", "vendor",
        "target", "__pycache__", ".venv", "venv", ".agents", ".claude", ".idea", ".vscode"}
CODE_EXT = (".ts", ".tsx", ".js", ".jsx", ".mjs", ".py", ".go", ".rs", ".php", ".cs", ".java",
            ".kt", ".vue", ".svelte", ".astro", ".sql", ".rb", ".dart", ".swift")
JS_STACK = [("next", "Next.js"), ("react", "React"), ("vue", "Vue"), ("svelte", "Svelte"), ("astro", "Astro"),
            ("hono", "Hono"), ("express", "Express"), ("fastify", "Fastify"), ("@nestjs/core", "NestJS"),
            ("drizzle-orm", "Drizzle"), ("@prisma/client", "Prisma"), ("mongoose", "Mongoose"),
            ("typeorm", "TypeORM"), ("pg", "PostgreSQL"), ("postgres", "PostgreSQL"), ("mysql2", "MySQL"),
            ("redis", "Redis"), ("ioredis", "Redis"), ("tailwindcss", "Tailwind"), ("zod", "Zod"),
            ("vitest", "Vitest"), ("jest", "Jest"), ("@playwright/test", "Playwright"), ("typescript", "TypeScript")]
SCRIPT_KEYS = ("test", "typecheck", "type-check", "lint", "check", "build", "dev")
NEXT = re.compile(r"(\*\*الجاي:?\*\*|الجاي:|\*\*Next:?\*\*|^Next:)\s*(.+)", re.M)
OPEN = re.compile(r"(\*\*مفتوح:?\*\*|مفتوح:|\*\*Open:?\*\*|^Open:)\s*(.+)", re.M)


def git(root, *args):
    try:
        p = subprocess.run(["git", "-C", root] + list(args), capture_output=True, text=True, timeout=5)
        return p.stdout.strip() if p.returncode == 0 else ""
    except Exception:
        return ""


def read_json(path):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return {}


def stack_and_commands(root):
    stack, cmds = [], []
    pkg = read_json(os.path.join(root, "package.json"))
    if pkg:
        deps = {**(pkg.get("dependencies") or {}), **(pkg.get("devDependencies") or {})}
        bun = any(os.path.isfile(os.path.join(root, f)) for f in ("bun.lockb", "bun.lock"))
        pnpm = os.path.isfile(os.path.join(root, "pnpm-lock.yaml"))
        runner = "bun run" if bun else "pnpm" if pnpm else "npm run"
        stack.append("Bun" if bun else "Node")
        for key, label in JS_STACK:
            if key in deps and label not in stack:
                ver = re.sub(r"[^\d.]", "", str(deps[key]))[:6]
                stack.append(f"{label} {ver}".strip() if label in ("Next.js", "React", "Hono") and ver else label)
        scripts = pkg.get("scripts") or {}
        for k in SCRIPT_KEYS:
            for name in scripts:
                if name == k or (name.startswith(k + ":") and len(cmds) < 7):
                    cmds.append(f"{name} `{runner} {name}`")
        if pkg.get("workspaces"):
            stack.append("workspaces")
    for manifest, label, extra in (("go.mod", "Go", "go test ./..."), ("Cargo.toml", "Rust", "cargo test"),
                                   ("pyproject.toml", "Python", "pytest"), ("composer.json", "PHP", None)):
        if os.path.isfile(os.path.join(root, manifest)):
            stack.append(label)
            if extra:
                cmds.append(f"test `{extra}`")
    if glob.glob(os.path.join(root, "*.csproj")) or glob.glob(os.path.join(root, "*.sln")):
        stack.append(".NET")
        cmds.append("test `dotnet test`")
    mk = os.path.join(root, "Makefile")
    if os.path.isfile(mk):
        try:
            for t in re.findall(r"^([a-z][\w-]*)\s*:", open(mk, encoding="utf-8").read(), re.M)[:20]:
                if t in SCRIPT_KEYS:
                    cmds.append(f"{t} `make {t}`")
        except OSError:
            pass
    return stack, cmds


def layout(root):
    counts = {}
    for entry in sorted(os.listdir(root)):
        full = os.path.join(root, entry)
        if entry in SKIP or entry.startswith(".") or not os.path.isdir(full):
            continue
        n = 0
        for dirpath, dirnames, files in os.walk(full):
            dirnames[:] = [d for d in dirnames if d not in SKIP and not d.startswith(".")]
            n += sum(1 for f in files if f.endswith(CODE_EXT))
            if n > 20000:
                break
        if n:
            counts[entry] = n
    top = sorted(counts.items(), key=lambda kv: -kv[1])[:8]
    return " · ".join(f"{d}/ ({n})" for d, n in top)


def cached_layout(root):
    head = git(root, "rev-parse", "HEAD")
    stamp = [head] + [str(int(os.path.getmtime(os.path.join(root, f)))) for f in
                      ("package.json", "go.mod", "Cargo.toml", "pyproject.toml") if os.path.isfile(os.path.join(root, f))]
    key = "|".join(stamp + sorted(e for e in os.listdir(root) if not e.startswith(".")))
    cache = os.path.join(root, kit_config.STORAGE_DIR, "scratch", "brief-layout.json")
    data = read_json(cache)
    if data.get("key") == key:
        return data.get("layout", "")
    value = layout(root)
    try:
        os.makedirs(os.path.dirname(cache), exist_ok=True)
        with open(cache, "w", encoding="utf-8") as fh:
            json.dump({"key": key, "layout": value}, fh)
    except OSError:
        pass
    return value


def continuation(root):
    files = sorted(glob.glob(os.path.join(root, "Plan", "Progress", "20*.md")))
    if not files:
        return None, None
    try:
        text = open(files[-1], encoding="utf-8").read()
    except OSError:
        return None, None
    nxt = NEXT.findall(text)
    opn = OPEN.findall(text)
    rel = os.path.relpath(files[-1], root).replace("\\", "/")
    clean = lambda s: s.strip().strip("*").strip()[:220]
    return rel, (clean(nxt[-1][1]) if nxt else None, clean(opn[-1][1]) if opn else None)


def memory_entries(root):
    path = os.path.join(root, kit_config.STORAGE_DIR, "memory", "MEMORY.md")
    try:
        return sum(1 for l in open(path, encoding="utf-8") if l.lstrip().startswith(("-", "*")))
    except OSError:
        return 0


def build(root):
    lines = ["# Project brief (auto-generated by sabry-kit; trust it over guessing, verify before relying on details)"]
    branch = git(root, "rev-parse", "--abbrev-ref", "HEAD")
    if branch:
        dirty = len([l for l in git(root, "status", "--porcelain").splitlines() if l.strip()])
        last = git(root, "log", "-1", "--format=%s (%cr)")
        lines.append(f"- Repo `{os.path.basename(root)}` · branch `{branch}` · {dirty} uncommitted"
                     + (f" · last commit: {last[:100]}" if last else ""))
    stack, cmds = stack_and_commands(root)
    if stack:
        lines.append(f"- Stack: {' · '.join(stack[:10])}")
    if cmds:
        lines.append(f"- Checks/commands: {' · '.join(dict.fromkeys(cmds))}")
    lay = cached_layout(root)
    if lay:
        lines.append(f"- Code folders (files): {lay}")
    n = memory_entries(root)
    if n:
        lines.append(f"- Project memory: `.agents/memory/MEMORY.md` has {n} entries; check it before exploring the codebase.")
    rel, cont = continuation(root)
    if rel and cont and any(cont):
        nxt, opn = cont
        lines.append(f"- Continue from `{rel}`:" + (f" next → {nxt}" if nxt else "") + (f" · open → {opn}" if opn else ""))
    if len(lines) == 1:
        return ""
    text = "\n".join(lines)
    return text[:MAX_CHARS]


def main():
    try:
        payload = json.load(sys.stdin)
        if not isinstance(payload, dict):
            payload = {}
    except Exception:
        payload = {}
    root = kit_config.project_root(payload.get("cwd"))
    if not root or not kit_config.enabled("project_brief", root):
        return 0
    text = build(root)
    if text:
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": text}},
                         ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        sys.exit(0)
