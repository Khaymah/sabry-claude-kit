#!/usr/bin/env python3
"""Run every request's hidden tests of a session against a copy of a workspace.

Usage: session_check.py <hidden-dir> <workspace>
Prints JSON {"r01": {"passed": N, "total": M}, ...}.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET

BASE = os.environ.get("BENCH_BASE", "/home/user/bench2/base")


def check(hidden, workspace, timeout=900):
    requests = sorted(d for d in os.listdir(hidden) if re.fullmatch(r"r\d\d", d))
    expected = {}
    for r in requests:
        n = 0
        for f in os.listdir(os.path.join(hidden, r)):
            if f.endswith(".test.ts"):
                n += len(re.findall(r"^\s*test\(", open(os.path.join(hidden, r, f), encoding="utf-8").read(), re.M))
        expected[r] = n
    tmp = tempfile.mkdtemp(prefix="session_check_")
    try:
        ws = os.path.join(tmp, "ws")
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
            proc = subprocess.run(["bun", "test", "./Tests/Hidden", "--reporter=junit", f"--reporter-outfile={junit}"],
                                  cwd=ws, capture_output=True, text=True, timeout=timeout)
            sys.stderr.write(proc.stdout[-8000:] + proc.stderr[-8000:])
        except subprocess.TimeoutExpired:
            sys.stderr.write("hidden tests timed out\n")
        result = {r: {"passed": 0, "total": 0} for r in requests}
        if os.path.exists(junit):
            for tc in ET.parse(junit).iter("testcase"):
                m = re.search(r"Tests/Hidden/(r\d\d)/", tc.get("file", ""))
                if not m:
                    continue
                r = m.group(1)
                result[r]["total"] += 1
                if tc.find("failure") is None and tc.find("error") is None and tc.find("skipped") is None:
                    result[r]["passed"] += 1
        for r in requests:
            result[r]["total"] = max(result[r]["total"], expected[r])
        return result
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    print(json.dumps(check(sys.argv[1], sys.argv[2])))
