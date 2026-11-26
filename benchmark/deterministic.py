#!/usr/bin/env python3
"""
Deterministic half of the benchmark: no model calls, same result on every run.

    python3 benchmark/deterministic.py --old <kit checkout> --new <kit checkout> [--out benchmark/results]

Measures, for each kit version:
  1. context      what the hooks inject at session start, per user message and per subagent
  2. knowledge    guidance files, situations, edge cases, verify checks, trap rows, topic coverage
  3. enforcement  a corpus of trap / clean snippets written through the kit's real Write hooks:
                  traps caught, false positives on clean code, hook latency
  4. on-demand    bytes an agent reads to follow the kit's guidance for typical tasks

Every hook runs in a throwaway HOME and project, so nothing on this machine changes.
"""
import argparse
import json
import os
import re
import shutil
import statistics
import subprocess
import sys
import tempfile
import time

PY = sys.executable

TOPICS = {
    "Password reset": r"password.?reset|forgot",
    "Sessions / refresh tokens": r"refresh.?token|sessions?\b",
    "Roles / permissions / IDOR": r"\brbac\b|permission|idor",
    "OAuth (Google/Apple)": r"oauth|sign in with (google|apple)",
    "API keys": r"api.?keys?",
    "OTP / 2FA": r"\botp\b|2fa|two.?factor|totp",
    "Money as minor units": r"minor unit|money",
    "Race conditions / stock": r"read.?check.?write|race|concurrency",
    "Live migrations": r"expand.*contract|migrations?",
    "Soft delete": r"soft.?delete",
    "Multi-tenancy / RLS": r"multi.?tenan|row.?level security|\brls\b",
    "Audit log": r"audit",
    "Idempotency / webhooks": r"idempoten",
    "Background jobs": r"background job|queue",
    "Third-party integrations": r"webhook|third.?party|outbound",
    "Rate limiting": r"rate.?limit",
    "Caching": r"cach(e|ing)",
    "Uploads": r"upload",
    "Import / export (CSV, Excel)": r"csv|excel|import",
    "REST design": r"rest\b|endpoint design|status code",
    "Pagination": r"paginat|keyset|cursor",
    "Error format": r"error (format|shape|code)",
    "API versioning": r"versioning|deprecat",
    "N+1 queries": r"n\+1|query performance",
    "Batching / round trips": r"round trip|batch",
    "Memory bounds": r"\bmemory\b|\boom\b",
    "Event loop / CPU": r"event.?loop|cpu",
    "Logging": r"logging|logger",
    "Request correlation": r"request.?id|correlation",
    "Error tracking": r"sentry|error tracking",
    "Metrics": r"metrics|prometheus",
    "Health checks": r"health.?check|readiness|liveness",
    "Alerting / SLOs": r"alert|\bslo",
    "Tracing": r"tracing|opentelemetry",
    "Error handling": r"error handling|apperror",
    "Graceful shutdown": r"graceful shutdown|sigterm",
    "Timeouts / retries": r"timeout|retr(y|ies)",
    "Backpressure / load shedding": r"backpressure|load shedding",
    "Test strategy": r"test strategy|test pyramid",
    "Integration tests on a real DB": r"integration test",
    "E2E tests": r"\be2e\b|end.?to.?end|playwright",
    "Concurrency tests": r"concurrency test",
    "Test data / factories": r"test data|factor(y|ies)|fixtures?",
    "SOLID (pragmatic)": r"\bsolid\b",
    "Module boundaries": r"module boundar|bounded context",
    "Naming": r"naming",
    "Complexity limits": r"complexity|max-depth",
    "Refactoring": r"refactor",
    "Tech debt": r"tech(nical)? debt",
}

KNOWLEDGE_DIRS = ("Playbooks", "Stacks", "Patterns", "Anti-patterns", "Roles", "Reference", "Decisions")
KNOWLEDGE_FILES = ("Quality-Gate.md",)

READ_PATHS = {
    "Design a password reset": {
        "old": ["Stacks/Bun-Hono.md", "Stacks/Database.md", "Roles/Senior-Engineer.md"],
        "new": ["Playbooks/INDEX.md", "Playbooks/quality/BASELINE.md", "Playbooks/backend/INDEX.md", "Playbooks/backend/auth/password-reset.md"],
    },
    "Fix an N+1 admin page": {
        "old": ["Stacks/Bun-Hono.md", "Stacks/Database.md", "Roles/Senior-Engineer.md", "Anti-patterns/README.md"],
        "new": ["Playbooks/INDEX.md", "Playbooks/quality/BASELINE.md", "Playbooks/quality/INDEX.md", "Playbooks/quality/performance/query-performance.md", "Playbooks/quality/TRAPS.md"],
    },
    "Review a diff": {
        "old": ["Roles/Senior-Engineer.md", "Anti-patterns/README.md", "Stacks/Bun-Hono.md"],
        "new": ["Roles/Senior-Engineer.md", "Playbooks/INDEX.md", "Playbooks/quality/BASELINE.md", "Playbooks/quality/TRAPS.md", "Stacks/Bun-Hono.md"],
    },
}

SERVICE = "Src/Modules/Orders/Orders.Service.ts"
CORPUS_TRAPS = [
    ("update without where", "Data", "await db.update(Users).set({ IsActive: false })\n"),
    ("delete without where", "Data", "return Tx\n  .delete(Sessions)\n"),
    ("forEach(async)", "Async", "Items.forEach(async (I) => { await Save(I) })\n"),
    ("sync hashing on a request path", "CPU", "const Hash = bcrypt.hashSync(Password, 10)\n"),
    ("execSync on a request path", "CPU", "const Out = execSync(`convert ${Path} out.png`)\n"),
    ("query in a for loop (N+1)", "Round trips", "for (const O of Orders) {\n  O.Customer = await db.query.Users.findFirst({ where: eq(Users.Id, O.CustomerId) })\n}\n"),
    ("query in a map callback (N+1)", "Round trips", "const Rows = Orders.map(async (O) => await UsersRepo.findById(O.CustomerId))\n"),
    ("insert per row in a loop", "Round trips", "for (const R of Rows) {\n  await db.insert(Products).values(R)\n}\n"),
    ("Promise.all over queries", "Round trips", "await Promise.all(Ids.map((Id) => db.select({ Id: Users.Id }).from(Users).where(eq(Users.Id, Id))))\n"),
    ("nested scan O(n*m)", "CPU", "const Out = Orders.map((O) => ({ ...O, Customer: Customers.find((C) => C.Id === O.CustomerId) }))\n"),
    ("fetch without timeout", "Reliability", "const Res = await fetch(Url, { method: \"POST\", body })\n"),
    ("unbounded z.array", "Input bounds", "export const S = z.object({ Ids: z.array(z.string().uuid()) })\n"),
    ("select every column", "Round trips", "const Rows = await db.select().from(Orders).limit(50)\n"),
    ("float money", "Money", "const TotalMinor = parseFloat(Body.Amount) * 100\n"),
    ("toFixed on money", "Money", "const Label = Order.Total.toFixed(2)\n"),
    ("empty catch", "Errors", "try { await Send() } catch (E) {}\n"),
    ("console in server code", "Observability", "console.log(\"order created\", Id)\n"),
    ("readFileSync on a request path", "CPU", "const Tpl = readFileSync(Path, \"utf8\")\n"),
    ("read-check-write on stock (needs semantics)", "Concurrency", "const P = await GetProduct(Id)\nif (P.Stock < Qty) throw new AppError(\"OUT_OF_STOCK\", 409)\nawait db.update(Products).set({ Stock: P.Stock - Qty }).where(eq(Products.Id, Id))\n"),
    ("IDOR: load by id only (needs semantics)", "Security", "const Order = await db.query.Orders.findFirst({ where: eq(Orders.Id, Id) })\nreturn Order\n"),
    ("JWT in localStorage (needs semantics)", "Security", "localStorage.setItem(\"token\", Res.AccessToken)\n"),
    ("SQL built by string (needs semantics)", "Security", "const Rows = await db.execute(sql.raw(`SELECT * FROM \"Users\" WHERE \"Email\" = '${Email}'`))\n"),
]
CORPUS_CLEAN = [
    ("update with where", "await db.update(Users).set({ IsActive: false }).where(eq(Users.Id, Id))\n"),
    ("chunked bulk insert", "for (let I = 0; I < Rows.length; I += CHUNK) {\n  await db.insert(Products).values(Rows.slice(I, I + CHUNK))\n}\n"),
    ("keyset batch loop", "while (true) {\n  const Batch = await db.select({ Id: Orders.Id }).from(Orders).where(gt(Orders.Id, Last)).limit(1000)\n  if (!Batch.length) break\n  Last = Batch[Batch.length - 1].Id\n}\n"),
    ("Map lookup", "const ById = new Map(Customers.map((C) => [C.Id, C]))\nconst Out = Orders.map((O) => ({ ...O, Customer: ById.get(O.CustomerId) }))\n"),
    ("small literal includes", "const Allowed = Roles.filter((R) => [\"Admin\", \"Owner\"].includes(R))\n"),
    ("constant list includes", "const Paid = Orders.filter((O) => PAID_STATUSES.includes(O.Status))\n"),
    ("fetch with timeout", "const Res = await fetch(Url, { method: \"POST\", body, signal: AbortSignal.timeout(5000) })\n"),
    ("bounded z.array", "export const S = z.object({ Ids: z.array(z.string().uuid()).min(1).max(500) })\n"),
    ("select named columns", "const Rows = await db.select({ Id: Orders.Id }).from(Orders).limit(50)\n"),
    ("minor units", "const TotalMinor = ToMinor(Body.Amount, Currency)\n"),
    ("handled catch", "try { await Send() } catch (E) { Log.warn({ err: E }, \"send failed\") }\n"),
    ("structured log", "Log.info({ OrderId: Id }, \"order created\")\n"),
    ("async password hash", "const Hash = await Bun.password.hash(Password)\n"),
    ("async file read", "const Tpl = await Bun.file(Path).text()\n"),
    ("bounded Promise.all", "await Promise.all([LoadOrders(Id), LoadUser(Id)])\n"),
    ("destructured Promise.all on a fixed pair", "const [A, B] = await Promise.all([GetA(), GetB()])\n"),
    ("select inside exists", "const Q = await db.select({ Id: T.Id }).from(T).where(exists(Tx.select().from(Users).where(eq(Users.Id, T.UserId))))\n"),
    ("atomic stock decrement", "const [Row] = await db.update(Products).set({ Stock: sql`${Products.Stock} - ${Qty}` }).where(and(eq(Products.Id, Id), gte(Products.Stock, Qty))).returning()\n"),
    ("owner-scoped lookup", "const Order = await db.query.Orders.findFirst({ where: and(eq(Orders.Id, Id), eq(Orders.CustomerId, UserId)) })\n"),
    ("delete with where", "await db.delete(Sessions).where(eq(Sessions.UserId, UserId))\n"),
]


def sandbox():
    root = tempfile.mkdtemp(prefix="kitbench-")
    home = os.path.join(root, "home")
    project = os.path.join(root, "project")
    os.makedirs(os.path.join(home, ".claude"))
    os.makedirs(project)
    subprocess.run(["git", "init", "-q", project], check=True)
    env = {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "HOME": home,
        "CLAUDE_CONFIG_DIR": os.path.join(home, ".claude"),
        "GIT_CONFIG_GLOBAL": os.path.join(home, ".gitconfig"),
        "SABRY_KIT_UPDATE_NOTICE": "0",
        "LANG": "C.UTF-8",
    }
    return root, project, env


def hook_commands(kit, event, tool=None):
    with open(os.path.join(kit, "hooks", "hooks.json"), encoding="utf-8") as fh:
        groups = json.load(fh)["hooks"].get(event, [])
    out = []
    for g in groups:
        matcher = g.get("matcher")
        if tool and matcher and not re.fullmatch(matcher, tool):
            continue
        if not tool and matcher:
            continue
        for h in g.get("hooks", []):
            cmd = h.get("command", "")
            if h.get("async") or "sounds/play" in cmd or "run-if-installed" in cmd or "usage.py" in cmd:
                continue
            out.append((cmd, h.get("timeout", 10)))
    return out


def run_hook(kit, cmd, payload, project, env):
    full = cmd.replace("${CLAUDE_PLUGIN_ROOT}", kit)
    e = dict(env, CLAUDE_PLUGIN_ROOT=kit, CLAUDE_PROJECT_DIR=project)
    start = time.perf_counter()
    try:
        p = subprocess.run(["bash", "-c", full], input=json.dumps(payload), capture_output=True, text=True,
                           cwd=project, env=e, timeout=60)
        out = p.stdout or ""
    except subprocess.TimeoutExpired:
        out = ""
    return out, (time.perf_counter() - start) * 1000


def context_of(stdout):
    text = stdout.strip()
    if not text:
        return ""
    try:
        data = json.loads(text)
    except ValueError:
        return text
    spec = data.get("hookSpecificOutput") or {}
    return (spec.get("additionalContext") or "") + (data.get("systemMessage") or "")


def decision_of(stdout):
    try:
        data = json.loads(stdout.strip() or "{}")
    except ValueError:
        return None
    spec = data.get("hookSpecificOutput") or {}
    if spec.get("permissionDecision") == "deny":
        return "deny"
    if data.get("decision") == "block":
        return "warn"
    return None


def measure_context(kit):
    root, project, env = sandbox()
    try:
        session = sum(len(context_of(run_hook(kit, c, {"hook_event_name": "SessionStart", "source": "startup", "cwd": project}, project, env)[0]))
                      for c, _ in hook_commands(kit, "SessionStart"))
        prompt = sum(len(context_of(run_hook(kit, c, {"hook_event_name": "UserPromptSubmit", "prompt": "صلّح الـ bug ده", "cwd": project}, project, env)[0]))
                     for c, _ in hook_commands(kit, "UserPromptSubmit"))
        sub = sum(len(context_of(run_hook(kit, c, {"hook_event_name": "SubagentStart", "agent_type": "senior-engineer", "cwd": project}, project, env)[0]))
                  for c, _ in hook_commands(kit, "SubagentStart"))
        return {"SessionStartChars": session, "PerMessageChars": prompt, "SubagentStartChars": sub}
    finally:
        shutil.rmtree(root, ignore_errors=True)


def knowledge_files(kit):
    files = []
    for d in KNOWLEDGE_DIRS:
        base = os.path.join(kit, d)
        for dirpath, _, names in os.walk(base):
            files += [os.path.join(dirpath, n) for n in names if n.endswith(".md")]
    files += [os.path.join(kit, f) for f in KNOWLEDGE_FILES if os.path.exists(os.path.join(kit, f))]
    return files


def measure_knowledge(kit):
    files = knowledge_files(kit)
    texts = {f: open(f, encoding="utf-8").read() for f in files}
    play = [f for f in files if "/Playbooks/" in f and os.path.basename(f) not in ("INDEX.md", "_template.md", "BASELINE.md", "TRAPS.md")]
    edge = verify = 0
    for f in play:
        t = texts[f]
        section = t.split("## Edge cases", 1)[1].split("\n## ", 1)[0] if "## Edge cases" in t else ""
        edge += max(0, len([l for l in section.splitlines() if l.startswith("|")]) - 2)
        verify += len(re.findall(r"^- \[ \]", t, re.M))
    traps_file = os.path.join(kit, "Playbooks", "quality", "TRAPS.md")
    traps = 0
    if os.path.exists(traps_file):
        traps = len([l for l in open(traps_file, encoding="utf-8") if l.startswith("| ") and not l.startswith("| Trap") and "---" not in l])
    headings = "\n".join(l.lower() for t in texts.values() for l in t.splitlines() if l.startswith("#") or l.startswith("| ") or l.startswith("- **"))
    covered = {name: bool(re.search(rx, headings)) for name, rx in TOPICS.items()}
    dedicated = {name: any(re.search(rx, os.path.basename(f).replace("-", " ").lower()) or re.search(rx, texts[f].splitlines()[0].lower() if texts[f] else "") for f in play)
                 for name, rx in TOPICS.items()}
    return {
        "GuidanceFiles": len(files),
        "GuidanceLines": sum(t.count("\n") for t in texts.values()),
        "Playbooks": len(play),
        "EdgeCaseRows": edge,
        "VerifyChecks": verify,
        "TrapRows": traps,
        "TopicsMentioned": sum(covered.values()),
        "TopicsWithDedicatedPlaybook": sum(dedicated.values()),
        "TopicsTotal": len(TOPICS),
        "Topics": {k: {"Mentioned": covered[k], "Dedicated": dedicated[k]} for k in TOPICS},
    }


def measure_enforcement(kit):
    root, project, env = sandbox()
    pre = hook_commands(kit, "PreToolUse", "Write")
    post = hook_commands(kit, "PostToolUse", "Write")
    path = os.path.join(project, SERVICE)

    def judge(content):
        payload = {"hook_event_name": "PreToolUse", "tool_name": "Write", "cwd": project,
                   "tool_input": {"file_path": path, "content": content}}
        verdict, total = None, 0.0
        for cmd, _ in pre:
            out, ms = run_hook(kit, cmd, payload, project, env)
            total += ms
            verdict = verdict or decision_of(out)
        payload["hook_event_name"] = "PostToolUse"
        for cmd, _ in post:
            out, ms = run_hook(kit, cmd, payload, project, env)
            total += ms
            verdict = verdict or decision_of(out)
        return verdict, total

    try:
        traps, latencies = [], []
        for name, category, code in CORPUS_TRAPS:
            v, ms = judge(code)
            latencies.append(ms)
            traps.append({"Name": name, "Category": category, "Verdict": v})
        clean = []
        for name, code in CORPUS_CLEAN:
            v, ms = judge(code)
            latencies.append(ms)
            clean.append({"Name": name, "Verdict": v})
        return {
            "WriteHooks": len(pre) + len(post),
            "TrapsCaught": sum(1 for t in traps if t["Verdict"]),
            "TrapsBlocked": sum(1 for t in traps if t["Verdict"] == "deny"),
            "TrapsTotal": len(traps),
            "FalsePositives": sum(1 for c in clean if c["Verdict"]),
            "CleanTotal": len(clean),
            "LatencyMsMedian": round(statistics.median(latencies), 1),
            "Traps": traps,
            "Clean": clean,
        }
    finally:
        shutil.rmtree(root, ignore_errors=True)


def measure_on_demand(kit, side):
    out = {}
    for task, paths in READ_PATHS.items():
        total = 0
        for p in paths[side]:
            f = os.path.join(kit, p)
            if os.path.exists(f):
                total += len(open(f, encoding="utf-8").read())
        out[task] = total
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--old", required=True)
    ap.add_argument("--new", required=True)
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "results"))
    a = ap.parse_args()
    result = {}
    for side, kit in (("old", os.path.abspath(a.old)), ("new", os.path.abspath(a.new))):
        print(f"[{side}] {kit}", file=sys.stderr)
        result[side] = {
            "Context": measure_context(kit),
            "Knowledge": measure_knowledge(kit),
            "Enforcement": measure_enforcement(kit),
            "OnDemandChars": measure_on_demand(kit, side),
            "Commit": subprocess.run(["git", "-C", kit, "rev-parse", "--short", "HEAD"], capture_output=True, text=True).stdout.strip(),
        }
    os.makedirs(a.out, exist_ok=True)
    with open(os.path.join(a.out, "deterministic.json"), "w", encoding="utf-8") as fh:
        json.dump(result, fh, ensure_ascii=False, indent=2)
    print(json.dumps({s: {k: v for k, v in r.items() if k != "Knowledge"} | {"Knowledge": {k: v for k, v in r["Knowledge"].items() if k != "Topics"}}
                      for s, r in result.items()}, ensure_ascii=False, indent=1, default=str)[:6000])


if __name__ == "__main__":
    main()
