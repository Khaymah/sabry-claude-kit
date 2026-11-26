#!/usr/bin/env python3
"""
Writes benchmark/RESULTS.md from benchmark/results/{deterministic.json, model-summary.json}.

    python3 benchmark/report.py [--results benchmark/results]
"""
import argparse
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ARMS = ("baseline", "kit-old", "kit-new")
NAMES = {"baseline": "No plugin", "kit-old": "Kit (before)", "kit-new": "Kit (Playbooks)"}


def pct(x):
    return "—" if x is None else f"{x * 100:.0f}%"


def num(x, digits=0):
    if x is None:
        return "—"
    return f"{x:,.{digits}f}"


def money(x):
    return "—" if x is None else f"${x:.3f}"


def table(header, rows):
    out = ["| " + " | ".join(header) + " |", "|" + "---|" * len(header)]
    out += ["| " + " | ".join(str(c) for c in r) + " |" for r in rows]
    return "\n".join(out)


def arm(group, name, key):
    return (group.get(name) or {}).get(key)


def model_sections(s):
    md = []
    meta = s["Meta"]
    md.append("## Setup\n")
    passes = sorted(meta.values(), key=lambda m: m.get("startedAt") or "")
    md.append(table(["Item", "Value"], [
        ["Model under test", passes[0].get("Model") or "session default"],
        ["Judge model", "haiku (default)"],
        ["Claude Code", passes[0].get("claudeVersion")],
        ["Runs", f"{s['Totals']['Runs']} (12 tasks × 3 arms × 3 runs)"],
        ["Dates", f"{(passes[0].get('startedAt') or '')[:10]} → {(passes[-1].get('startedAt') or '')[:10]}"],
        ["Total cost of the runs (list price)", money(s["Totals"]["CostUsd"])],
        ["Runs dropped for account limits", "re-run in a second pass; none scored"],
    ]))
    o = s["Overall"]["All"]
    md.append("\n## Headline\n")
    rows = []
    metrics = [
        ("Grader score (rubrics + checks)", "GraderScore", pct),
        ("Hidden correctness tests (build/fix tasks)", "HiddenScore", pct),
        ("Code traps left in written code (per run)", "CodeTraps", lambda x: num(x, 2)),
        ("Cost per run", "CostUsd", money),
        ("Turns per run", "Turns", lambda x: num(x, 1)),
        ("Duration per run (s)", "DurationSeconds", lambda x: num(x, 0)),
        ("Input tokens per run (incl. cache)", "InputTokens", lambda x: num(x, 0)),
        ("Output tokens per run", "OutputTokens", lambda x: num(x, 0)),
        ("Runs", "Runs", lambda x: num(x, 0)),
        ("Runs with errors", "Errors", lambda x: num(x, 0)),
    ]
    for label, key, fmt in metrics:
        rows.append([label] + [fmt(arm(o, a, key)) for a in ARMS])
    md.append(table(["Metric"] + [NAMES[a] for a in ARMS], rows))

    for title, key, order in (("By difficulty", "ByTier", ("Easy", "Medium", "Hard")),
                              ("By task type", "ByKind", ("build", "fix", "design", "review"))):
        md.append(f"\n## {title}\n")
        rows = []
        for g in order:
            grp = s[key].get(g)
            if not grp:
                continue
            rows.append([g] + [pct(arm(grp, a, "GraderScore")) for a in ARMS] + [pct(arm(grp, a, "HiddenScore")) for a in ARMS]
                        + [money(arm(grp, a, "CostUsd")) for a in ARMS])
        md.append(table([title.split()[-1].capitalize()] + [f"Score · {NAMES[a]}" for a in ARMS] + [f"Hidden · {NAMES[a]}" for a in ARMS]
                        + [f"Cost · {NAMES[a]}" for a in ARMS], rows))

    md.append("\n## Per task\n")
    rows = []
    for case in sorted(s["ByCase"]):
        g = s["ByCase"][case]
        rows.append([f"`{case}`"] + [f"{pct(arm(g, a, 'GraderScore'))} / {pct(arm(g, a, 'HiddenScore'))}" for a in ARMS]
                    + [num(arm(g, a, "CodeTraps"), 1) for a in ARMS])

    md.append(table(["Task"] + [f"{NAMES[a]} (score / hidden)" for a in ARMS] + [f"Traps · {NAMES[a]}" for a in ARMS], rows))
    return md


def deterministic_sections(d):
    md = ["\n## Deterministic checks (no model)\n"]
    o, n = d["old"], d["new"]
    md.append(f"Old kit `{o['Commit']}` vs new kit `{n['Commit']}`. Same inputs on every run; the injected context varies by a few hundred characters with the date and the environment (the project brief and update notices).\n")
    md.append("### Context the kit adds\n")
    md.append(table(["Injected", "Kit (before)", "Kit (Playbooks)"], [
        ["At session start (chars)", num(o["Context"]["SessionStartChars"]), num(n["Context"]["SessionStartChars"])],
        ["Per user message (chars)", num(o["Context"]["PerMessageChars"]), num(n["Context"]["PerMessageChars"])],
        ["Per coding subagent (chars)", num(o["Context"]["SubagentStartChars"]), num(n["Context"]["SubagentStartChars"])],
    ]))
    md.append("\nThe library is read on demand, never injected. Characters an agent reads to follow the kit for one task:\n")
    md.append(table(["Task", "Kit (before)", "Kit (Playbooks)"],
                    [[t, num(o["OnDemandChars"][t]), num(n["OnDemandChars"][t])] for t in n["OnDemandChars"]]))
    ko, kn = o["Knowledge"], n["Knowledge"]
    md.append("\n### Knowledge\n")
    md.append(table(["Measure", "Kit (before)", "Kit (Playbooks)"], [
        ["Guidance files", ko["GuidanceFiles"], kn["GuidanceFiles"]],
        ["Guidance lines", num(ko["GuidanceLines"]), num(kn["GuidanceLines"])],
        ["Playbooks (one situation, one decision, three levels)", ko["Playbooks"], kn["Playbooks"]],
        ["Edge cases with expected behaviour", ko["EdgeCaseRows"], kn["EdgeCaseRows"]],
        ["Verify checks", ko["VerifyChecks"], kn["VerifyChecks"]],
        ["Traps with a mechanical detector", ko["TrapRows"], kn["TrapRows"]],
        [f"Topics with a dedicated playbook (of {kn['TopicsTotal']})", ko["TopicsWithDedicatedPlaybook"], kn["TopicsWithDedicatedPlaybook"]],
        [f"Topics at least mentioned (of {kn['TopicsTotal']})", ko["TopicsMentioned"], kn["TopicsMentioned"]],
    ]))
    eo, en = o["Enforcement"], n["Enforcement"]
    md.append("\n### Enforcement while writing code\n")
    md.append(f"{en['TrapsTotal']} snippets with a known trap and {en['CleanTotal']} correct snippets, written through each kit's real Write hooks.\n")
    md.append(table(["Measure", "Kit (before)", "Kit (Playbooks)"], [
        ["Traps caught", f"{eo['TrapsCaught']}/{eo['TrapsTotal']}", f"{en['TrapsCaught']}/{en['TrapsTotal']}"],
        ["…of which blocked before writing", eo["TrapsBlocked"], en["TrapsBlocked"]],
        ["False positives on correct code", f"{eo['FalsePositives']}/{eo['CleanTotal']}", f"{en['FalsePositives']}/{en['CleanTotal']}"],
        ["Write hooks run", eo["WriteHooks"], en["WriteHooks"]],
        ["Median hook time per write (ms)", eo["LatencyMsMedian"], en["LatencyMsMedian"]],
    ]))
    md.append("\n<details><summary>Every trap snippet</summary>\n")
    by_old = {t["Name"]: t["Verdict"] for t in eo["Traps"]}
    md.append(table(["Trap", "Category", "Kit (before)", "Kit (Playbooks)"],
                    [[t["Name"], t["Category"], by_old.get(t["Name"]) or "missed", t["Verdict"] or "missed"] for t in en["Traps"]]))
    md.append("\n</details>\n")
    return md


METHOD = """
## Method

- **Arms.** *No plugin*: plain Claude Code. *Kit (before)*: the kit at `main` before the Playbooks work. *Kit (Playbooks)*: this branch. Every arm gets the same prompt, fixture, tools and model.
- **Tasks.** 12 tasks in `benchmark/cases/`, written in Arabic as the owner would type them: 3 easy, 4 medium, 5 hard: 4 build and 3 fix tasks on a real fixture (including a stock race, an N+1 page and a tenant leak), 4 design tasks and 1 code review.
- **Grader score.** The `claude plugin eval` graders of each task: regex checks on the written files or the reply, tool checks (were the tests run?) and rubric judges (Haiku, majority of three votes).
- **Hidden correctness.** After each run, independent tests in `benchmark/hidden/` run against a copy of the code the agent wrote, with instrumented modules swapped in (query counters, concurrent buyers, cross-tenant requests, tampered webhooks). The agent never sees them.
- **Code traps.** `hooks/enforce-code-traps.py` (deny and warn tiers) scanned over the files each run wrote. Lower is better.
- **Cost and tokens.** From each run's own result record, at list price.
- **Reproduce:** `benchmark/run.sh origin/main 3 sonnet`.

## Limits

- 3 runs per arm per task: differences of a few points are within noise; look at the hidden tests and the hard tier.
- Rubric judges are a model; the hidden tests and regex checks are not.
- The fixtures use plain Node modules so they run anywhere; the kit's stack is Bun + Hono + Drizzle, so stack-specific guidance is exercised mostly in the design tasks.
- The benchmark was written by the same author as the Playbooks. The tasks come from common production failures, not from the playbook text, and the hidden tests were checked against both broken and correct reference code before the run.
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--results", default=os.path.join(HERE, "results"))
    a = ap.parse_args()
    md = ["# sabry-kit benchmark\n", "Generated by `benchmark/report.py`. Raw data: `benchmark/results/`.\n"]
    sp = os.path.join(a.results, "model-summary.json")
    if os.path.exists(sp):
        md += model_sections(json.load(open(sp, encoding="utf-8")))
    dp = os.path.join(a.results, "deterministic.json")
    if os.path.exists(dp):
        md += deterministic_sections(json.load(open(dp, encoding="utf-8")))
    md.append(METHOD)
    with open(os.path.join(HERE, "RESULTS.md"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(md).rstrip() + "\n")
    print(os.path.join(HERE, "RESULTS.md"))


if __name__ == "__main__":
    main()
