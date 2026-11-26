#!/usr/bin/env python3
"""
Turns the `claude plugin eval --json` results of the benchmark into one summary.

    python3 benchmark/collect.py --run new=<new.json> --run old=<old.json> [--out benchmark/results] [--cleanup]

Arms: `baseline` is the no-plugin arm of the new run, `kit-new` its plugin arm, `kit-old` the
plugin arm of the old run. Each run kept by `--keep-temp` is also checked independently:
  - hidden tests (benchmark/hidden/<case>.test.mjs) on a copy of the code the agent wrote,
    with the case's instrumented modules swapped in (<case>.<module>.mjs → src/<module>.mjs)
  - code traps found by hooks/enforce-code-traps.py in the files the agent wrote
  - tokens and cost from the run's own result record
Nothing inside the kept directories is executed in place; `--cleanup` deletes them at the end.
"""
import argparse
import glob
import importlib.util
import json
import os
import re
import shutil
import statistics
import subprocess
import tempfile

INFRA_ERROR = re.compile(r"hit your .*limit|rate.?limit|overloaded|authentication|credit balance", re.I)

HERE = os.path.dirname(os.path.abspath(__file__))
HIDDEN = os.path.join(HERE, "hidden")
CASES = os.path.join(HERE, "cases")
KIT = os.path.dirname(HERE)

spec = importlib.util.spec_from_file_location("traps", os.path.join(KIT, "hooks", "enforce-code-traps.py"))
traps = importlib.util.module_from_spec(spec)
spec.loader.exec_module(traps)


def tier_of(case):
    return {"e": "Easy", "m": "Medium", "h": "Hard"}.get(case[:1], "Other")


def kind_of(case):
    p = os.path.join(CASES, case, "prompt.md")
    tags = re.search(r"^tags:\s*\[(.*?)\]", open(p, encoding="utf-8").read(), re.M)
    t = [x.strip() for x in tags.group(1).split(",")] if tags else []
    return next((x for x in ("build", "fix", "design", "review") if x in t), "other")


def usage_of(trace):
    try:
        with open(trace, encoding="utf-8") as fh:
            for line in fh:
                m = json.loads(line)
                if m.get("type") == "result":
                    u = m.get("usage") or {}
                    return {"InputTokens": (u.get("input_tokens") or 0) + (u.get("cache_creation_input_tokens") or 0) + (u.get("cache_read_input_tokens") or 0),
                            "OutputTokens": u.get("output_tokens") or 0}
    except (OSError, ValueError):
        pass
    return {"InputTokens": None, "OutputTokens": None}


def hidden_check(case, workspace):
    test = os.path.join(HIDDEN, f"{case}.test.mjs")
    src = os.path.join(workspace, "src")
    if not os.path.exists(test) or not os.path.isdir(src):
        return None
    tmp = tempfile.mkdtemp(prefix="hidden-")
    try:
        shutil.copytree(src, os.path.join(tmp, "src"), symlinks=False, ignore=shutil.ignore_patterns("node_modules"))
        for f in glob.glob(os.path.join(HIDDEN, f"{case}.*.mjs")):
            mod = os.path.basename(f)[len(case) + 1:]
            if mod != "test.mjs":
                shutil.copy(f, os.path.join(tmp, "src", mod))
        shutil.copy(os.path.join(HIDDEN, "_util.mjs"), tmp)
        shutil.copy(test, os.path.join(tmp, "hidden.test.mjs"))
        with open(os.path.join(tmp, "package.json"), "w") as fh:
            fh.write('{ "type": "module" }\n')
        p = subprocess.run(["node", "--test", "--test-timeout=60000", "hidden.test.mjs"], cwd=tmp, capture_output=True, text=True, timeout=180)
        passed = int((re.search(r"^# pass (\d+)", p.stdout, re.M) or [0, 0])[1])
        failed = int((re.search(r"^# fail (\d+)", p.stdout, re.M) or [0, 0])[1])
        total = passed + failed
        return {"Passed": passed, "Total": total, "Score": passed / total if total else 0.0}
    except (OSError, subprocess.TimeoutExpired, shutil.Error):
        return {"Passed": 0, "Total": 0, "Score": 0.0}
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def code_traps(workspace):
    found = 0
    for f in glob.glob(os.path.join(workspace, "src", "**", "*.mjs"), recursive=True):
        try:
            text = open(f, encoding="utf-8").read()
        except OSError:
            continue
        path = "Src/Modules/X/" + os.path.basename(f).replace(".mjs", ".service.mjs")
        found += len(traps.deny_findings(text, path)) + len(traps.warn_findings(text, path))
    return found


def collect(label, data, arm):
    rows = []
    for case in data.get("cases", []):
        for run in case.get("arms", {}).get(arm, []) or []:
            if run.get("error") and INFRA_ERROR.search(str(run["error"])):
                continue
            trace = run.get("tracePath") or ""
            base = os.path.dirname(os.path.dirname(trace)) if trace else ""
            workspace = os.path.join(base, "home", "cwd")
            row = {
                "Arm": label, "Case": case["name"], "Tier": tier_of(case["name"]), "Kind": kind_of(case["name"]),
                "Score": run.get("score") or 0.0, "Passed": bool(run.get("passed")), "Error": run.get("error"),
                "Turns": run.get("turns"), "CostUsd": run.get("costUsd"), "DurationSeconds": run.get("durationSeconds"),
                "Graders": {g.get("name"): g.get("passed") for g in run.get("graders") or []},
                **usage_of(trace),
                "Hidden": hidden_check(case["name"], workspace) if os.path.isdir(workspace) else None,
                "CodeTraps": code_traps(workspace) if os.path.isdir(workspace) else None,
                "KeptDir": base,
            }
            rows.append(row)
    return rows


def mean(xs):
    xs = [x for x in xs if x is not None]
    return round(statistics.mean(xs), 3) if xs else None


def summarise(rows, key):
    out = {}
    for arm in sorted({r["Arm"] for r in rows}):
        for group in sorted({r[key] for r in rows}):
            sel = [r for r in rows if r["Arm"] == arm and r[key] == group]
            if not sel:
                continue
            hidden = [r["Hidden"]["Score"] for r in sel if r["Hidden"]]
            out.setdefault(group, {})[arm] = {
                "Runs": len(sel),
                "GraderScore": mean([r["Score"] for r in sel]),
                "HiddenScore": mean(hidden) if hidden else None,
                "CodeTraps": mean([r["CodeTraps"] for r in sel]),
                "CostUsd": mean([r["CostUsd"] for r in sel]),
                "Turns": mean([r["Turns"] for r in sel]),
                "DurationSeconds": mean([r["DurationSeconds"] for r in sel]),
                "InputTokens": mean([r["InputTokens"] for r in sel]),
                "OutputTokens": mean([r["OutputTokens"] for r in sel]),
                "Errors": sum(1 for r in sel if r["Error"]),
            }
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", action="append", required=True, help="new=path.json or old=path.json")
    ap.add_argument("--out", default=os.path.join(HERE, "results"))
    ap.add_argument("--cleanup", action="store_true")
    ap.add_argument("--merge-rows", action="append", default=[], help="model-runs.json of an earlier pass; its infrastructure failures are dropped")
    a = ap.parse_args()
    rows = []
    meta = {}
    for spec_ in a.run:
        side, path = spec_.split("=", 1)
        data = json.load(open(path, encoding="utf-8"))
        side_key = side if side not in meta else f"{side}-{len(meta)}"
        meta[side_key] = {k: data.get(k) for k in ("claudeVersion", "startedAt", "durationSeconds", "costUsd", "partial", "partialReason")}
        meta[side_key]["Model"] = (data.get("suite") or {}).get("modelOverride")
        if side == "new":
            rows += collect("kit-new", data, "with") + collect("baseline", data, "without")
        else:
            rows += collect("kit-old", data, "with")
    for f in a.merge_rows:
        rows += [dict(r, KeptDir="") for r in json.load(open(f, encoding="utf-8")) if not (r.get("Error") and INFRA_ERROR.search(str(r["Error"])))]
    summary = {
        "Meta": meta,
        "Totals": {"Runs": len(rows), "CostUsd": round(sum(r["CostUsd"] or 0 for r in rows), 2)},
        "Overall": summarise([dict(r, All="All") for r in rows], "All"),
        "ByTier": summarise(rows, "Tier"),
        "ByKind": summarise(rows, "Kind"),
        "ByCase": summarise(rows, "Case"),
    }
    os.makedirs(a.out, exist_ok=True)
    with open(os.path.join(a.out, "model-runs.json"), "w", encoding="utf-8") as fh:
        json.dump([{k: v for k, v in r.items() if k != "KeptDir"} for r in rows], fh, ensure_ascii=False, indent=1)
    with open(os.path.join(a.out, "model-summary.json"), "w", encoding="utf-8") as fh:
        json.dump(summary, fh, ensure_ascii=False, indent=1)
    print(json.dumps(summary["Overall"], indent=1))
    if a.cleanup:
        for d in {r["KeptDir"] for r in rows if r["KeptDir"].startswith("/tmp/claude-eval-")}:
            subprocess.run(["chmod", "-R", "u+rwX", d], capture_output=True)
            shutil.rmtree(d, ignore_errors=True)


if __name__ == "__main__":
    main()
