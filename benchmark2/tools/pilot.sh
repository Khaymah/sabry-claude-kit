#!/usr/bin/env bash
set -uo pipefail
B=/home/user/bench2; OUT=${OUT_DIR:-$B/pilot}; mkdir -p $OUT
$B/tools/seal.sh seal
rm -rf ${PLUGIN_DIR:-$B/empty-plugin}/cases; mkdir -p ${PLUGIN_DIR:-$B/empty-plugin}/cases; for pat in ${CASES:-*}; do for c in $B/cases/$pat/; do cp -R "$c" ${PLUGIN_DIR:-$B/empty-plugin}/cases/; done; done
for c in ${PLUGIN_DIR:-$B/empty-plugin}/cases/*/; do rm -rf "$c/reference/fixed" "$c/hidden"; done
cd ${PLUGIN_DIR:-$B/empty-plugin}
claude plugin eval . --eval-dir cases --runs "${RUNS:-2}" --scaffold --keep-temp --trust-plugin --ablation none \
  --allow-tools Write Edit "Bash(bun *)" "Bash(cd *)" "Bash(ls *)" "Bash(cat *)" --model sonnet --no-publish \
  --threshold 0 -j 4 --max-cost-usd "${BUDGET:-14}" --json $OUT/pilot.json > $OUT/pilot.log 2>&1
rm -rf ${PLUGIN_DIR:-$B/empty-plugin}/cases
$B/tools/seal.sh unseal
python3 - <<'PY'
import json, os, subprocess, re
B="/home/user/bench2"; d=json.load(open(f"{os.environ.get("OUT_DIR",B+"/pilot")}/pilot.json")); rows=[]
for c in d["cases"]:
    for r in c["arms"].get("with", []):
        tp=r.get("tracePath") or ""; ws=os.path.join(os.path.dirname(os.path.dirname(tp)),"home","cwd")
        h={"passed":0,"total":0}
        if os.path.isdir(ws):
            out=subprocess.run(["python3",f"{B}/hidden_check.py",c["name"],ws],capture_output=True,text=True,timeout=300).stdout.strip().splitlines()
            try: h=json.loads(out[-1])
            except Exception: pass
        leak=bool(os.path.exists(tp) and re.search(r"bench2/cases|bench2/base|\.bench2-vault", open(tp,errors="replace").read()))
        rows.append({"case":c["name"],"hidden":h,"score":r.get("score"),"cost":r.get("costUsd"),"leak":leak})
json.dump(rows,open(f"{os.environ.get("OUT_DIR",B+"/pilot")}/rows.json","w"),indent=1)
PY
for d in /tmp/claude-eval-*; do chmod -R u+rwX "$d" 2>/dev/null; rm -rf "$d"; done
echo done
