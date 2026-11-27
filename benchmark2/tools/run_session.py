#!/usr/bin/env python3
"""Run one long-session benchmark through the Claude Code CLI.

Usage: run_session.py <session> <workspace> [--plugin-dir DIR] [--model sonnet]
                      [--max-budget-usd N] [--request-timeout SECONDS]

The workspace must be outside /home/user/bench2. Streams are saved next to it,
in <workspace>.streams/. Prints a JSON summary on stdout.

The CLI's result event reports total_cost_usd cumulatively for a resumed
session, so the summary takes per-turn deltas. Settings are limited to the
project (--setting-sources project,local) so the user's own plugins do not
load; pass --plugin-dir to add the plugin under test.
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time

ROOT = "/home/user/bench2"
SESSIONS = os.path.join(ROOT, "sessions")
SEALED = "/root/.bench2-sealed"
SECRET_PARTS = [("reference", "fixed"), ("reference", "alt"), ("hidden",)]
ALLOWED = ["Write", "Edit", "Read", "Glob", "Grep", "Bash(bun *)", "Bash(cd *)", "Bash(ls *)", "Bash(cat *)"]

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from session_check import check  # noqa: E402


def load_yaml(path):
    data = {"requests": [], "compact_after": []}
    current = None
    for line in open(path, encoding="utf-8"):
        line = line.rstrip("\n")
        m = re.match(r"^\s*-\s*id:\s*(\S+)", line)
        if m:
            current = {"id": m.group(1)}
            data["requests"].append(current)
            continue
        m = re.match(r"^\s+prompt:\s*(\S+)", line)
        if m and current is not None:
            current["prompt"] = m.group(1)
            continue
        m = re.match(r"^compact_after:\s*\[(.*)\]", line)
        if m:
            data["compact_after"] = [int(x) for x in m.group(1).split(",") if x.strip()]
            continue
        m = re.match(r"^(\w+):\s*(.*)$", line)
        if m and m.group(1) not in ("requests",):
            data[m.group(1)] = m.group(2).strip().strip('"')
    return data


def seal():
    if os.path.exists(SEALED):
        raise SystemExit(f"{SEALED} already exists; restore it first (a previous run may have crashed)")
    moved = []
    os.makedirs(SEALED)
    for name in sorted(os.listdir(SESSIONS)):
        sdir = os.path.join(SESSIONS, name)
        if not os.path.isdir(sdir):
            continue
        for parts in SECRET_PARTS:
            src = os.path.join(sdir, *parts)
            if os.path.exists(src):
                dst = os.path.join(SEALED, name, *parts)
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                shutil.move(src, dst)
                moved.append((dst, src))
    return moved


def unseal(moved):
    for dst, src in moved:
        if os.path.exists(dst):
            os.makedirs(os.path.dirname(src), exist_ok=True)
            shutil.move(dst, src)
    shutil.rmtree(SEALED, ignore_errors=True)


def build_workspace(session_dir, workspace):
    if os.path.exists(workspace):
        shutil.rmtree(workspace)
    subprocess.run(["bash", os.path.join(ROOT, "tools", "build_session.sh"), session_dir, "broken", workspace], check=True)


def run_claude(prompt, workspace, stream_path, args, session_id):
    cmd = ["claude", "-p", "--output-format", "stream-json", "--verbose", "--model", args.model,
           "--permission-mode", "dontAsk", "--setting-sources", "project,local", "--strict-mcp-config",
           "--tools", "Read,Write,Edit,Glob,Grep,Bash"]
    if args.plugin_dir:
        cmd += ["--plugin-dir", args.plugin_dir]
    if args.max_budget_usd:
        cmd += ["--max-budget-usd", str(args.max_budget_usd)]
    if session_id:
        cmd += ["--resume", session_id]
    cmd += ["--allowedTools", *ALLOWED]
    started = time.time()
    with open(stream_path, "w", encoding="utf-8") as out:
        try:
            proc = subprocess.run(cmd, input=prompt, cwd=workspace, stdout=out, stderr=subprocess.PIPE, text=True, timeout=args.request_timeout)
            code, err = proc.returncode, proc.stderr
        except subprocess.TimeoutExpired:
            code, err = -1, "timeout"
    events = []
    for line in open(stream_path, encoding="utf-8"):
        line = line.strip()
        if line:
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    new_id = session_id
    cost = None
    for e in events:
        if e.get("session_id"):
            new_id = e["session_id"]
        if e.get("type") == "result":
            cost = float(e.get("total_cost_usd") or 0)
    compacted = any(e.get("type") == "system" and e.get("subtype") == "compact_boundary" for e in events)
    return {"session_id": new_id, "cost": cost, "compacted": compacted, "code": code, "stderr": err[-2000:], "seconds": round(time.time() - started, 1)}


def scan_leaks(stream_dir):
    hits = []
    pattern = re.compile(r"bench2(-sealed)?")
    for name in sorted(os.listdir(stream_dir)):
        for line in open(os.path.join(stream_dir, name), encoding="utf-8"):
            try:
                e = json.loads(line)
            except json.JSONDecodeError:
                continue
            if e.get("type") != "assistant":
                continue
            for block in (e.get("message") or {}).get("content") or []:
                if block.get("type") == "tool_use" and pattern.search(json.dumps(block.get("input"))):
                    hits.append({"stream": name, "tool": block.get("name"), "input": json.dumps(block.get("input"))[:300]})
    return hits


def main():
    p = argparse.ArgumentParser()
    p.add_argument("session")
    p.add_argument("workspace")
    p.add_argument("--plugin-dir")
    p.add_argument("--model", default="sonnet")
    p.add_argument("--max-budget-usd", type=float)
    p.add_argument("--request-timeout", type=int, default=1500)
    p.add_argument("--no-seal", action="store_true", help="the caller already sealed the references")
    args = p.parse_args()
    name = os.path.basename(os.path.normpath(args.session))
    session_dir = os.path.join(SESSIONS, name)
    workspace = os.path.abspath(args.workspace)
    if workspace.startswith(ROOT):
        raise SystemExit("the workspace must be outside /home/user/bench2")
    stream_dir = workspace.rstrip("/") + ".streams"
    shutil.rmtree(stream_dir, ignore_errors=True)
    os.makedirs(stream_dir)
    spec = load_yaml(os.path.join(session_dir, "session.yaml"))
    moved = [] if args.no_seal else seal()
    summary = {"session": name, "requests": {}, "cost_usd": 0.0, "compactions": 0, "compactions_requested": len(spec["compact_after"]), "turns": []}
    spent = {"total": 0.0}

    def account(cost):
        if cost is None:
            return 0.0
        delta = max(0.0, cost - spent["total"]) if cost >= spent["total"] else cost
        spent["total"] = cost if cost >= spent["total"] else spent["total"] + cost
        return delta
    try:
        build_workspace(session_dir, workspace)
        session_id = None
        for index, req in enumerate(spec["requests"], start=1):
            prompt = open(os.path.join(session_dir, req["prompt"]), encoding="utf-8").read()
            r = run_claude(prompt, workspace, os.path.join(stream_dir, f"{req['id']}.jsonl"), args, session_id)
            session_id = r["session_id"]
            summary["turns"].append({"request": req["id"], "code": r["code"], "cost": round(account(r["cost"]), 4), "seconds": r["seconds"], "stderr": r["stderr"] if r["code"] else ""})
            if index in spec["compact_after"] and session_id:
                c = run_claude("/compact", workspace, os.path.join(stream_dir, f"{req['id']}-compact.jsonl"), args, session_id)
                session_id = c["session_id"]
                summary["compactions"] += 1 if c["compacted"] else 0
                summary["turns"].append({"request": f"{req['id']}-compact", "code": c["code"], "cost": round(account(c["cost"]), 4), "seconds": c["seconds"], "compacted": c["compacted"]})
        hidden = os.path.join(SEALED, name, "hidden")
        summary["requests"] = check(hidden, workspace)
        summary["session_id"] = session_id
    finally:
        if not args.no_seal:
            unseal(moved)
    leaks = scan_leaks(stream_dir)
    summary["leak"] = bool(leaks)
    summary["leaks"] = leaks[:20]
    summary["cost_usd"] = round(spent["total"], 4)
    summary["streams"] = stream_dir
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
