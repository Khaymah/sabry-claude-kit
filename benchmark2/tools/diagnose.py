import json, os, re, subprocess, sys, glob
B = "/home/user/bench2"
heads = {}
for p in glob.glob(f"{B}/cases/*/prompt.md"):
    body = open(p, encoding="utf-8").read().split("---", 2)[-1].strip()
    heads[os.path.basename(os.path.dirname(p))] = body[:40]
for run in sorted(glob.glob(f"{sys.argv[1]}/*/")):
    tp = os.path.join(run, "trace.jsonl")
    if not os.path.exists(tp):
        continue
    first, ctx = "", ""
    for line in open(tp, errors="replace"):
        try: e = json.loads(line)
        except ValueError: continue
        s = json.dumps(e, ensure_ascii=False)
        if "[playbooks]" in s and not ctx: ctx = s
        if not first and e.get("type") == "user":
            c = e["message"].get("content")
            first = c if isinstance(c, str) else " ".join(x.get("text", "") for x in c if isinstance(x, dict))
    if not first:
        first = open(tp, errors="replace").read()
    case = next((c for c, h in heads.items() if h and h in first), None)
    injected = sorted(set(re.findall(r"Playbooks/([a-z0-9/\-]+\.md)", ctx)))
    p = subprocess.run(["python3", f"{B}/hidden_check.py", case or "?", os.path.join(run, "cwd")], capture_output=True, text=True, timeout=300)
    fails = re.findall(r"\(fail\)\s+(.+?)(?:\s+\[[\d.]+m?s\])?$", p.stderr, re.M)
    print(f"== {case} {p.stdout.strip()} injected={injected}")
    for f in fails: print("   FAIL", f[:160])
