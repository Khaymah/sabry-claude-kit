#!/usr/bin/env python3
import json, os, subprocess, sys, time
sys.path.insert(0, "/home/user/bench2/tools")
from session_check import check
ROOT = "/home/user/bench2/sessions"
WS = "/tmp/claude-0/sess_verify"
rows = []
ok_all = True
for s in sorted(d for d in os.listdir(ROOT) if d.startswith("s")):
    res = {}
    for kind in ("broken", "fixed", "alt"):
        ws = f"{WS}/{s}/{kind}"
        subprocess.run(["bash", "/home/user/bench2/tools/build_session.sh", f"{ROOT}/{s}", kind, ws], check=True)
        t = time.time()
        with open(os.devnull, "w") as devnull:
            old = sys.stderr; sys.stderr = devnull
            try:
                res[kind] = check(f"{ROOT}/{s}/hidden", ws)
            finally:
                sys.stderr = old
        res[kind + "_s"] = round(time.time() - t, 1)
    for r in sorted(res["fixed"]):
        b, f, a = res["broken"][r], res["fixed"][r], res["alt"][r]
        good = b["passed"] < b["total"] and f["passed"] == f["total"] > 0 and a["passed"] == a["total"]
        ok_all &= good
        rows.append(f"| {s} | {r} | {b['passed']}/{b['total']} | {f['passed']}/{f['total']} | {a['passed']}/{a['total']} | {'yes' if good else 'NO'} |")
    print(s, json.dumps({k: res[k] for k in ('broken', 'fixed', 'alt')}))
open("/tmp/claude-0/sessions_table.md", "w").write("\n".join(rows) + "\n")
print("ALL OK" if ok_all else "FAILURES")
