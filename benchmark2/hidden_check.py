#!/usr/bin/env python3
"""Run a case's hidden tests against a copy of a workspace.

Usage: hidden_check.py <case-id-or-dir> <workspace>
Prints JSON {"passed": N, "total": M} on stdout; details go to stderr.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.abspath(__file__))
BASE = os.environ.get("BENCH_BASE", os.path.join(ROOT, "base"))
TEST_TIMEOUT = int(os.environ.get("HIDDEN_TIMEOUT", "600"))


def case_dir(arg):
    if os.path.isdir(arg):
        return os.path.abspath(arg)
    return os.path.join(ROOT, "cases", arg)


def static_count(hidden):
    total = 0
    for name in os.listdir(hidden):
        if name.endswith(".test.ts"):
            with open(os.path.join(hidden, name), encoding="utf-8") as f:
                total += len(re.findall(r"^\s*test\(", f.read(), re.M))
    return total


def main():
    if len(sys.argv) != 3:
        print(__doc__, file=sys.stderr)
        sys.exit(2)
    case = case_dir(sys.argv[1])
    workspace = os.path.abspath(sys.argv[2])
    hidden = os.path.join(case, "hidden")
    expected = static_count(hidden)
    tmp = tempfile.mkdtemp(prefix="hidden_check_")
    ws = os.path.join(tmp, "ws")
    started = time.time()
    try:
        shutil.copytree(workspace, ws, symlinks=True, ignore=shutil.ignore_patterns("node_modules", ".git"))
        modules = os.path.join(workspace, "node_modules")
        if not os.path.isdir(modules):
            modules = os.path.join(BASE, "node_modules")
        os.symlink(os.path.realpath(modules), os.path.join(ws, "node_modules"))
        target = os.path.join(ws, "Tests", "Hidden")
        shutil.rmtree(target, ignore_errors=True)
        shutil.copytree(hidden, target)
        junit = os.path.join(tmp, "junit.xml")
        try:
            proc = subprocess.run(
                ["bun", "test", "./Tests/Hidden", "--reporter=junit", f"--reporter-outfile={junit}"],
                cwd=ws, capture_output=True, text=True, timeout=TEST_TIMEOUT,
            )
            sys.stderr.write(proc.stdout[-6000:] + proc.stderr[-6000:])
        except subprocess.TimeoutExpired:
            sys.stderr.write("hidden tests timed out\n")
        passed = 0
        total = 0
        if os.path.exists(junit):
            tree = ET.parse(junit)
            for tc in tree.iter("testcase"):
                total += 1
                if tc.find("failure") is None and tc.find("error") is None and tc.find("skipped") is None:
                    passed += 1
        total = max(total, expected)
        sys.stderr.write(f"runtime: {time.time() - started:.1f}s\n")
        print(json.dumps({"passed": passed, "total": total}))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
