#!/usr/bin/env python3
"""
Catches the code traps of Playbooks/quality/TRAPS.md while the code is being written,
so they no longer depend on the agent remembering to read the catalogue.

Two tiers, one script:

  PreToolUse (no flag)  DENY what is a bug in every project and cheap to fix:
      - an awaited or returned `db.update(...)` / `db.delete(...)` chain with no `.where(`
        (every row changes)
      - `.forEach(async ...)` (the promises are never awaited)
      - blocking crypto / process calls (`bcrypt.hashSync`, `pbkdf2Sync`, `scryptSync`,
        `execSync`, `spawnSync`) in request-path files (routes, controllers, services,
        handlers, Next.js route handlers and server actions)

  PostToolUse (--warn)  WARN about what is usually a trap but needs judgement; the
      reason goes back to the model, which fixes it or says in one line why it is fine:
      - a database call awaited inside a loop or a per-item callback (N+1)
      - `Promise.all(<list>.map(...))` with a database call inside (N queries at once)
      - `.find(` / `.includes(` / `.indexOf(` inside a loop or a per-item callback
        (O(n*m); a Map or Set is O(n))
      - `fetch(` with no `signal` (no timeout)
      - `z.array(...)` with no `.max(` (unbounded input)
      - `select().from(` (SELECT * on a list)
      - `parseFloat(` / `.toFixed(` near a money name (Price, Amount, Total, Balance, Cost)
      - an empty `catch {}`
      - `console.log` / `console.error` in server code
      - `*Sync(` file reads and writes in request-path files

Only what this edit ADDS is checked: a finding whose line already exists in the
old_string is legacy and is not reported. Loops over fixed chunks or keyset batches
(`+= CHUNK`, `.limit(` inside the body) are the accepted way to batch and are not
reported as N+1.

Scope: .ts .tsx .mts .cts .js .jsx .mjs .cjs, outside tests, scripts, migrations and
seeds. Switch: settings.code_traps (default on).
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    import kit_config
except Exception:
    kit_config = None

CODE_EXT = (".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs")
SKIP_PATH = re.compile(
    r"(^|/)(tests?|__tests__|spec|e2e|scripts?|migrations?|seeds?|fixtures?|node_modules|dist|build)/"
    r"|\.(test|spec|e2e|stories)\.[cm]?[jt]sx?$|(^|/)(drizzle|vite|next|eslint|tailwind|postcss)\.config\.",
    re.I)
REQUEST_PATH = re.compile(
    r"(^|/)(routes?|controllers?|services?|handlers?|api|actions?|modules)/"
    r"|\.(routes?|controller|service|handler|actions?)\.[cm]?[jt]sx?$"
    r"|(^|/)(route|actions)\.[cm]?[jt]sx?$",
    re.I)

DB_RECEIVER = r"(?:db|Db|DB|tx|Tx|trx|Trx|prisma|knex|sql|pool|client)"
WRITE_CHAIN = re.compile(r"\b(await|return)\s+" + DB_RECEIVER + r"\s*\.\s*(update|delete)\s*\(")
DB_CALL = re.compile(
    r"\bawait\s+(?:" + DB_RECEIVER + r"\s*[.`(]"
    r"|[A-Za-z_$][\w$]*\s*\.\s*(?:query\s*\.\s*\w+\s*\.\s*)?"
    r"(?:findFirst|findMany|findUnique|findOne|findAll|findById|execute|select|insert|update|delete|upsert)\s*\()")
LOOP_HEAD = re.compile(r"\b(for|while)\s*\(")
ITER_CALL = re.compile(r"\.\s*(forEach|map|flatMap|filter|reduce|some|every)\s*\(")
NESTED_SCAN = re.compile(r"\.\s*(find|findIndex|includes|indexOf)\s*\(")
FOREACH_ASYNC = re.compile(r"\.\s*forEach\s*\(\s*async\b")
SYNC_BLOCKING = re.compile(r"\b(hashSync|compareSync|genSaltSync|pbkdf2Sync|scryptSync|execSync|execFileSync|spawnSync)\s*\(")
SYNC_FILE = re.compile(r"\b(readFileSync|writeFileSync|appendFileSync|readdirSync|statSync)\s*\(")
FETCH = re.compile(r"(?<![\w$.])fetch\s*\(")
Z_ARRAY = re.compile(r"\bz\s*\.\s*array\s*\(")
SELECT_STAR = re.compile(r"\.\s*select\s*\(\s*\)\s*\.\s*from\s*\(")
MONEY_FLOAT = re.compile(r"(parseFloat\s*\(|\.toFixed\s*\()[^\n;]*?(price|amount|total|balance|cost|fee|tax)"
                         r"|(price|amount|total|balance|cost|fee|tax)\w*\s*[\])]*\s*\.toFixed\s*\("
                         r"|parseFloat\s*\([^)]*(price|amount|total|balance|cost|fee|tax)", re.I)
EMPTY_CATCH = re.compile(r"\bcatch\s*(\([^)]*\))?\s*\{\s*\}")
CONSOLE = re.compile(r"\bconsole\s*\.\s*(log|error|warn|info|debug)\s*\(")
BATCH_LOOP = re.compile(r"\+=\s*[A-Z][A-Z0-9_]{2,}\b|\b(chunk|batch|CHUNK|BATCH|Chunk|Batch)\w*\b")

MAX_FINDINGS = 6


def _close(src, i, open_ch, close_ch):
    """i is at open_ch. Index just past its matching close_ch, skipping strings,
    template literals and comments; len(src) when unbalanced."""
    depth, n = 0, len(src)
    while i < n:
        c = src[i]
        if c in "'\"`":
            q, i = c, i + 1
            while i < n and src[i] != q:
                i += 2 if src[i] == "\\" else 1
            i += 1
            continue
        if src.startswith("//", i):
            j = src.find("\n", i)
            i = n if j == -1 else j
            continue
        if src.startswith("/*", i):
            j = src.find("*/", i + 2)
            i = n if j == -1 else j + 2
            continue
        if c == open_ch:
            depth += 1
        elif c == close_ch:
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    return n


def _line_of(src, i):
    start = src.rfind("\n", 0, i) + 1
    end = src.find("\n", i)
    return src[start:end if end != -1 else len(src)].strip()


def _chain_methods(src, i):
    """i is at the `(` of the first call of a chain. Names of the chained methods."""
    names, n = [], len(src)
    i = _close(src, i, "(", ")")
    while i < n:
        m = re.match(r"\s*\.\s*([A-Za-z_$][\w$]*)\s*(\(|<)", src[i:])
        if not m:
            break
        names.append(m.group(1))
        j = i + m.end() - 1
        if src[j] == "<":
            j = _close(src, j, "<", ">")
            if j >= n or src[j] != "(":
                break
        i = _close(src, j, "(", ")")
    return names


def _bodies(src):
    """(start, end, kind, header) of every loop body and per-item callback."""
    out = []
    for m in LOOP_HEAD.finditer(src):
        p = src.find("(", m.start())
        after = _close(src, p, "(", ")")
        header = src[p:after]
        rest = src[after:]
        k = len(rest) - len(rest.lstrip())
        if after + k < len(src) and src[after + k] == "{":
            out.append((after + k, _close(src, after + k, "{", "}"), "loop", header))
    for m in ITER_CALL.finditer(src):
        p = m.end() - 1
        out.append((p, _close(src, p, "(", ")"), m.group(1), ""))
    return out


def _inside_any(i, spans):
    return any(a < i < b for a, b, _, _ in spans)


def _call_args(src, i):
    p = src.find("(", i)
    return src[p:_close(src, p, "(", ")")]


def deny_findings(src, path):
    found = []
    for m in WRITE_CHAIN.finditer(src):
        p = src.find("(", m.end() - 1)
        if "where" not in _chain_methods(src, p):
            found.append((m.start(), f"`.{m.group(2)}(...)` with no `.where(...)`: every row of the table changes. "
                                      "Add the condition (and `NotDeleted(...)` where it applies)."))
    for m in FOREACH_ASYNC.finditer(src):
        found.append((m.start(), "`.forEach(async ...)`: forEach never awaits, so errors are lost and the work "
                                 "finishes after the caller moves on. Use `for ... of` or `Promise.all` with a limit."))
    if REQUEST_PATH.search(path):
        for m in SYNC_BLOCKING.finditer(src):
            found.append((m.start(), f"`{m.group(1)}` blocks the event loop for every user on a request path. "
                                     "Use the async API (`Bun.password.hash`, `crypto.scrypt`, `Bun.spawn`)."))
    return found


def warn_findings(src, path):
    found = []
    spans = _bodies(src)
    for a, b, kind, header in spans:
        body = src[a:b]
        if kind == "loop" and (BATCH_LOOP.search(header) or ".limit(" in body):
            continue
        if kind in ("reduce", "some", "every") or not DB_CALL.search(body):
            continue
        m = DB_CALL.search(body)
        where = "a loop" if kind == "loop" else f"`.{kind}(...)`"
        found.append((a + m.start(), f"database call awaited inside {where}: one query per item (N+1). Load all "
                                     "items with one `IN` / join / `with:` query and group them with a Map "
                                     "(Playbooks/quality/performance/query-performance.md)."))
    for m in re.finditer(r"Promise\s*\.\s*all\s*\(", src):
        args = _call_args(src, m.start())
        if ITER_CALL.search(args) and (DB_CALL.search(args) or re.search(r"\b" + DB_RECEIVER + r"\s*\.", args)):
            found.append((m.start(), "`Promise.all(list.map(...))` with a database call: N queries and N pool "
                                     "connections at once. One batched query, or `p-limit` for real fan-out "
                                     "(Playbooks/quality/performance/round-trips.md)."))
    iter_spans = [s for s in spans if s[2] in ("loop", "forEach", "map", "flatMap", "filter", "reduce")]
    for m in NESTED_SCAN.finditer(src):
        before = src[max(0, m.start() - 40):m.start()].rstrip()
        if before.endswith("]") or re.search(r"\b[A-Z][A-Z0-9_]{2,}$", before):
            continue
        if _inside_any(m.start(), iter_spans):
            found.append((m.start(), f"`.{m.group(1)}(` inside a loop or per-item callback is O(n*m). If both lists "
                                     "can grow with users or data, build a Map / Set once before the loop "
                                     "(Playbooks/quality/performance/event-loop-cpu.md)."))
            break
    for m in FETCH.finditer(src):
        if "signal" not in _call_args(src, m.start()):
            found.append((m.start(), "`fetch(` with no `signal`: no timeout, a slow provider holds the request "
                                     "forever. Pass `signal: AbortSignal.timeout(ms)`."))
    for m in Z_ARRAY.finditer(src):
        if not {"max", "length"} & set(_chain_methods(src, src.find("(", m.start()))):
            found.append((m.start(), "`z.array(...)` with no `.max(...)`: one request can send 100,000 items. "
                                     "Cap it to what the feature needs."))
    for m in SELECT_STAR.finditer(src):
        found.append((m.start(), "`select().from(...)` reads every column. On lists and exports select the "
                                 "fields the response shows."))
    for m in MONEY_FLOAT.finditer(src):
        found.append((m.start(), "float arithmetic on money (`parseFloat` / `toFixed`): use integer minor units "
                                 "(Playbooks/backend/data/money.md). Formatting for display only is fine."))
    for m in EMPTY_CATCH.finditer(src):
        found.append((m.start(), "empty `catch {}`: the error disappears. Handle it, or let it reach the error "
                                 "handler (Playbooks/quality/reliability/error-handling.md)."))
    if not path.endswith((".tsx", ".jsx")):
        for m in CONSOLE.finditer(src):
            found.append((m.start(), "`console.*` in server code: use the project logger with fields "
                                     "(Playbooks/quality/observability/logging.md)."))
            break
    if REQUEST_PATH.search(path):
        for m in SYNC_FILE.finditer(src):
            found.append((m.start(), f"`{m.group(1)}` on a request path blocks every user while the disk works. "
                                     "Use the async API (`Bun.file`, `fs/promises`)."))
    return found


def _segments(ti):
    out = []
    if isinstance(ti.get("content"), str):
        out.append((ti["content"], ""))
    if isinstance(ti.get("new_string"), str):
        out.append((ti["new_string"], ti.get("old_string") or ""))
    for e in ti.get("edits") or []:
        if isinstance(e, dict) and isinstance(e.get("new_string"), str):
            out.append((e["new_string"], e.get("old_string") or ""))
    return out


def collect(ti, finder):
    path = str(ti.get("file_path") or "").replace("\\", "/")
    if not path.lower().endswith(CODE_EXT) or SKIP_PATH.search(path):
        return []
    lines, seen = [], set()
    for added, old in _segments(ti):
        old_lines = {l.strip() for l in old.splitlines() if l.strip()}
        for pos, message in finder(added, path):
            line = _line_of(added, pos)
            if line in old_lines or (line, message) in seen:
                continue
            seen.add((line, message))
            lines.append(f"- `{line[:100]}`\n  {message}")
    return lines[:MAX_FINDINGS]


def main():
    warn = "--warn" in sys.argv[1:]
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return 0
    if kit_config and not kit_config.gate("code_traps", payload):
        return 0
    ti = payload.get("tool_input") or {}
    if not isinstance(ti, dict):
        return 0
    name = os.path.basename(str(ti.get("file_path") or ""))
    if warn:
        lines = collect(ti, warn_findings)
        if lines:
            print(json.dumps({"decision": "block", "reason": (
                f"[code-traps] Likely traps in what you just wrote to {name}:\n" + "\n".join(lines) +
                "\nFix each one, or say in one line why it is safe here (a small fixed list, a script, "
                "display formatting). Catalogue: Playbooks/quality/TRAPS.md.")}))
        return 0
    lines = collect(ti, deny_findings)
    if lines:
        print(json.dumps({"hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": (
                f"[code-traps] Blocked: this edit to {name} adds a bug the kit never lets through:\n"
                + "\n".join(lines) + "\nFix it and write the edit again. Catalogue: Playbooks/quality/TRAPS.md."),
        }}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
