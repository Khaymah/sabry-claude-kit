#!/usr/bin/env python3
import json, os, subprocess, sys, time, shutil
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import run_session as rs
OUT = sys.argv[1]
ARMS = json.loads(sys.argv[2])
SESSIONS = sorted(d for d in os.listdir(rs.SESSIONS) if d.startswith("s"))
JOBS = []
for arm in ARMS:
    for run in range(arm["runs"]):
        for s in SESSIONS:
            JOBS.append((run, arm["name"], arm.get("plugin"), arm["model"], s))
JOBS.sort(key=lambda j: (j[0], j[4], j[1]))
os.makedirs(OUT, exist_ok=True)
def one(job):
    run, name, plugin, model, s = job
    tag = f"{name}-{model}-{s}-r{run}"
    res = os.path.join(OUT, tag + ".json")
    if os.path.exists(res):
        return
    ws = f"/home/user/ws/{tag}"
    cmd = [sys.executable, os.path.join(os.path.dirname(__file__), "run_session.py"), s, ws, "--model", model, "--no-seal"]
    if plugin:
        cmd += ["--plugin-dir", plugin]
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=7200)
    try:
        data = json.loads(p.stdout)
    except Exception:
        data = {"error": p.stderr[-2000:]}
    data.update({"arm": name, "model": model, "run": run})
    json.dump(data, open(res, "w"), ensure_ascii=False, indent=1)
    shutil.rmtree(ws, ignore_errors=True)
moved = rs.seal()
try:
    with ThreadPoolExecutor(max_workers=int(os.environ.get("PAR", "6"))) as pool:
        list(pool.map(one, JOBS))
finally:
    rs.unseal(moved)
open(os.path.join(OUT, "DONE"), "w").write(time.ctime())
