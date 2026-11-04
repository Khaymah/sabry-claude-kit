#!/usr/bin/env python3
"""
Runs an optional CLI only when it is on PATH; otherwise exits 0 without output.

    python3 hooks/run-if-installed.py code-review-graph update

Lets the kit wire hooks for tools that not every machine has (code-review-graph today)
without every session on a machine that lacks them printing "command not found".
stdin is passed through untouched, so the tool still receives the hook payload.
"""
import shutil
import subprocess
import sys


def main():
    if len(sys.argv) < 2:
        return 0
    exe = shutil.which(sys.argv[1])
    if not exe:
        return 0
    try:
        return subprocess.run([exe] + sys.argv[2:], stdin=sys.stdin).returncode
    except Exception:
        return 0


if __name__ == "__main__":
    sys.exit(main())
