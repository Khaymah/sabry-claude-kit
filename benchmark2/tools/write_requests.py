import sys, re, json
session = sys.argv[1]
text = sys.stdin.read()
parts = re.split(r"^=== (r\d\d) (.*)$", text, flags=re.M)
end = "نفّذ. ماتسألنيش، افترض الافتراضات المنطقية واذكرها في الآخر."
base = f"/home/user/bench2/sessions/{session}"
reqs = []
for i in range(1, len(parts), 3):
    rid, meta, body = parts[i], parts[i + 1].strip(), parts[i + 2].strip()
    open(f"{base}/requests/{rid}.md", "w").write(body + "\n\n" + end + "\n")
    reqs.append((rid, meta))
compact = sys.argv[2]
with open(f"{base}/session.yaml", "w") as f:
    f.write(f"name: {session}\n")
    f.write(f"description: \"{sys.argv[3]}\"\n")
    f.write("requests:\n")
    for rid, meta in reqs:
        f.write(f"  - id: {rid}\n    prompt: requests/{rid}.md\n")
    f.write(f"compact_after: [{compact}]\n")
with open(f"{base}/hidden/risks.yaml", "w") as f:
    for rid, meta in reqs:
        f.write(f"{rid}: \"{meta}\"\n")
