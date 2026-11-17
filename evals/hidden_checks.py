#!/usr/bin/env python3
"""
Runs eval cases with and without the kit and scores what each run left behind with tests
the agent never saw.

    python3 evals/hidden_checks.py [case ...] [--runs N] [--max-cost-usd X] [--keep]

`claude plugin eval` grades the transcript and the files, but has no graders that run code.
This script runs the same cases with `--keep-temp`, then, for every run of every case that
has a `hidden/` folder, runs `node --test hidden/*.test.mjs` with TARGET set to that run's
workspace, and measures the change itself:

    hidden checks    share of the hidden tests that pass (correctness)
    code lines       lines added outside test files (smaller is better at equal correctness)
    test lines       lines added in test files
    with a test      share of runs that added or changed a test (risky logic should leave one)
    cost, time       from the eval's own result

Prints a table per case and writes `hidden-checks.md` and `.json` beside the eval report.
Cases without `hidden/` are skipped. Needs node and the eval requirements (sandbox, credentials).
"""
import glob
import json
import os
import re
import shutil
import statistics
import subprocess
import sys
import tempfile

EVALS = os.path.dirname(os.path.abspath(__file__))
KIT = os.path.dirname(EVALS)
TEST_PATH = re.compile(r"(^|/)(tests?|__tests__)/|\.(test|spec)\.[a-z]+$", re.I)
TOOLS = ["Write", "Edit", "Bash(node *)", "Bash(npm *)", "Bash(git *)", "Bash(bun *)"]


def hidden_cases(names):
    found = sorted(os.path.basename(os.path.dirname(d)) for d in glob.glob(os.path.join(EVALS, "*", "hidden")))
    return [c for c in found if not names or c in names]


def run_eval(case, runs, max_cost):
    """One eval per case: `claude plugin eval` keeps only the last of several --case flags."""
    args = ["claude", "plugin", "eval", ".", "--runs", str(runs), "--scaffold", "--trust-plugin", "--keep-temp",
            "-j", "2", "--max-cost-usd", str(max_cost), "--case", case, "--allow-tools"] + TOOLS
    p = subprocess.run(args, cwd=KIT, capture_output=True, text=True, timeout=7200)
    out = p.stdout + p.stderr
    m = re.search(r"Report:\s*(\S+)/report\.html", out)
    if not m:
        raise SystemExit("hidden_checks: the eval produced no report\n" + out[-2000:])
    return m.group(1)


def workspace(trace_path):
    root = os.path.dirname(os.path.dirname(trace_path or ""))
    path = os.path.join(root, "home", "cwd")
    return path if os.path.isdir(path) else None


def hidden_score(case, ws):
    tests = sorted(glob.glob(os.path.join(EVALS, case, "hidden", "*.test.mjs")))
    env = dict(os.environ, TARGET=ws)
    p = subprocess.run(["node", "--test"] + tests, capture_output=True, text=True, env=env, timeout=300)
    passed = re.search(r"^# pass (\d+)", p.stdout, re.M)
    failed = re.search(r"^# fail (\d+)", p.stdout, re.M)
    ok, bad = int(passed.group(1)) if passed else 0, int(failed.group(1)) if failed else 0
    names = re.findall(r"^not ok \d+ - (.+)$", p.stdout, re.M)
    return ok, ok + bad, names


def change_size(ws):
    with tempfile.TemporaryDirectory() as tmp:
        copy = os.path.join(tmp, "ws")
        shutil.copytree(ws, copy, symlinks=True, ignore=shutil.ignore_patterns("node_modules"))
        git = lambda *a: subprocess.run(["git", "-C", copy] + list(a), capture_output=True, text=True, timeout=60).stdout
        root = git("rev-list", "--max-parents=0", "HEAD").split()
        if not root:
            return 0, 0
        git("add", "-A", "-N")
        code = tests = 0
        for line in git("diff", "--numstat", root[0]).splitlines():
            parts = line.split("\t")
            if len(parts) < 3 or not parts[0].isdigit():
                continue
            if TEST_PATH.search(parts[2]):
                tests += int(parts[0])
            else:
                code += int(parts[0])
        return code, tests


def summarize(rows):
    mean = lambda xs: statistics.mean(xs) if xs else 0
    med = lambda xs: statistics.median(xs) if xs else 0
    return {
        "runs": len(rows),
        "hidden_pass": mean([r["hidden_ok"] / r["hidden_total"] for r in rows if r["hidden_total"]]),
        "code_lines": med([r["code"] for r in rows]),
        "test_lines": med([r["tests"] for r in rows]),
        "with_a_test": mean([1 if r["tests"] else 0 for r in rows]),
        "cost": mean([r["cost"] for r in rows]),
        "seconds": mean([r["seconds"] for r in rows]),
    }


def main():
    args = sys.argv[1:]
    runs = int(args[args.index("--runs") + 1]) if "--runs" in args else 2
    max_cost = float(args[args.index("--max-cost-usd") + 1]) if "--max-cost-usd" in args else 10
    names = [a for i, a in enumerate(args) if not a.startswith("--") and (i == 0 or args[i - 1] not in
                                                                         ("--runs", "--max-cost-usd"))]
    cases = hidden_cases(names)
    if not cases:
        raise SystemExit("hidden_checks: no case with a hidden/ folder matches")
    report, lines, temps, collected = {}, [], set(), []
    for name in cases:
        results_dir = run_eval(name, runs, max_cost)
        with open(os.path.join(results_dir, "aggregate-result.json"), encoding="utf-8") as fh:
            collected += json.load(fh).get("cases", [])
    for case in collected:
        if case["name"] not in cases:
            continue
        report[case["name"]] = {}
        lines += [f"\n## {case['name']}\n", "| arm | runs | hidden checks | code lines | test lines | with a test | cost | time |",
                  "|---|--:|--:|--:|--:|--:|--:|--:|"]
        for arm in ("with", "without"):
            rows = []
            for run in case.get("arms", {}).get(arm, []):
                ws = workspace(run.get("tracePath"))
                if not ws:
                    continue
                temps.add(os.path.dirname(os.path.dirname(os.path.dirname(ws))))
                ok, total, failed = hidden_score(case["name"], ws)
                code, tests = change_size(ws)
                rows.append({"hidden_ok": ok, "hidden_total": total, "failed": failed, "code": code, "tests": tests,
                             "cost": run.get("costUsd") or 0, "seconds": run.get("durationSeconds") or 0})
            s = summarize(rows)
            report[case["name"]][arm] = {"summary": s, "runs": rows}
            lines.append(f"| {arm} | {s['runs']} | {s['hidden_pass']:.0%} | {s['code_lines']:.0f} | {s['test_lines']:.0f} | "
                         f"{s['with_a_test']:.0%} | ${s['cost']:.2f} | {s['seconds']:.0f}s |")
    text = "# Hidden checks\n" + "\n".join(lines) + "\n"
    with open(os.path.join(results_dir, "hidden-checks.md"), "w", encoding="utf-8") as fh:
        fh.write(text)
    with open(os.path.join(results_dir, "hidden-checks.json"), "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2, ensure_ascii=False)
    print(text)
    print(f"Written: {results_dir}/hidden-checks.md")
    if "--keep" not in args:
        for t in temps:
            if os.path.basename(t).startswith("claude-eval-"):
                shutil.rmtree(t, ignore_errors=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
