#!/usr/bin/env python3
"""
Token meter: where a session's tokens actually went, measured from the transcript.

    usage.py record              SessionEnd hook: append this session's summary to
                                 <project>/.agents/sessions/usage.jsonl
    usage.py report [--last N]   table over the recorded sessions of this project
    usage.py report --current    the session that is running now (newest transcript)
    usage.py report --json       same data as JSON (for the kit-stats skill)

What it measures, per session (main agent + every subagent transcript):

    API calls, input (uncached / cache write / cache read), output, cache hit rate,
    a relative cost index (uncached 1 · cache write 1.25-2 · cache read 0.1 · output 5),
    which tools produced the most result text (that text is re-sent on every later
    turn, so it is the main driver of context growth), the single largest results,
    files read more than once, full reads of large files, and subagent spend.

Claude Code writes one transcript line per content block, so API calls are counted
once per message id. Result sizes are characters; tokens ≈ chars / 3.5 for English
and code, fewer characters per token for Arabic.
"""
import collections
import glob
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit_config

WEIGHTS = {"input": 1.0, "cache_write_5m": 1.25, "cache_write_1h": 2.0, "cache_read": 0.1, "output": 5.0}
BIG_READ_LINES = 800


def result_text(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(c.get("text", "") for c in content if isinstance(c, dict))
    return ""


def parse(path):
    calls = {}
    tools = {}
    results = collections.defaultdict(lambda: {"calls": 0, "chars": 0})
    biggest = []
    reads = collections.Counter()
    full_big_reads = []
    try:
        fh = open(path, encoding="utf-8")
    except OSError:
        return None
    with fh:
        for line in fh:
            try:
                d = json.loads(line)
            except Exception:
                continue
            msg = d.get("message") or {}
            if d.get("type") == "assistant":
                mid = msg.get("id") or d.get("uuid")
                if msg.get("usage") and mid not in calls:
                    calls[mid] = msg["usage"]
                for c in msg.get("content") or []:
                    if isinstance(c, dict) and c.get("type") == "tool_use":
                        tools[c.get("id")] = (c.get("name", "?"), c.get("input") or {})
            elif d.get("type") == "user" and isinstance(msg.get("content"), list):
                for c in msg["content"]:
                    if not (isinstance(c, dict) and c.get("type") == "tool_result"):
                        continue
                    name, inp = tools.get(c.get("tool_use_id"), ("?", {}))
                    text = result_text(c.get("content"))
                    results[name]["calls"] += 1
                    results[name]["chars"] += len(text)
                    label = (inp.get("file_path") or inp.get("command") or inp.get("url") or inp.get("query")
                             or inp.get("pattern") or inp.get("description") or "")
                    biggest.append((len(text), name, str(label)[:90]))
                    if name == "Read" and inp.get("file_path"):
                        reads[inp["file_path"]] += 1
                        if not inp.get("limit") and not inp.get("offset") and text.count("\n") >= BIG_READ_LINES:
                            full_big_reads.append(inp["file_path"])
    totals = collections.Counter()
    for u in calls.values():
        totals["input"] += u.get("input_tokens", 0) or 0
        totals["cache_read"] += u.get("cache_read_input_tokens", 0) or 0
        cc = u.get("cache_creation") or {}
        w1h = cc.get("ephemeral_1h_input_tokens", 0) or 0
        w5m = cc.get("ephemeral_5m_input_tokens", 0) or 0
        if not cc:
            w5m = u.get("cache_creation_input_tokens", 0) or 0
        totals["cache_write_1h"] += w1h
        totals["cache_write_5m"] += w5m
        totals["output"] += u.get("output_tokens", 0) or 0
    return {"calls": len(calls), "tokens": dict(totals), "results": dict(results),
            "biggest": sorted(biggest, reverse=True)[:8], "reads": reads, "full_big_reads": full_big_reads}


def session_files(transcript):
    base = os.path.splitext(transcript)[0]
    return [transcript] + sorted(glob.glob(os.path.join(base, "subagents", "*.jsonl")))


def summarize(transcript, session_id=None):
    main = None
    sub = {"count": 0, "calls": 0, "cost_index": 0.0, "result_chars": 0}
    merged_results = collections.defaultdict(lambda: {"calls": 0, "chars": 0})
    reads = collections.Counter()
    biggest, full_big = [], []
    for i, path in enumerate(session_files(transcript)):
        p = parse(path)
        if not p:
            continue
        for k, v in p["results"].items():
            merged_results[k]["calls"] += v["calls"]
            merged_results[k]["chars"] += v["chars"]
        reads.update(p["reads"])
        biggest += p["biggest"]
        full_big += p["full_big_reads"]
        if i == 0:
            main = p
        else:
            sub["count"] += 1
            sub["calls"] += p["calls"]
            sub["cost_index"] += cost_index(p["tokens"])
    if not main:
        return None
    tok = main["tokens"]
    inputs = tok.get("input", 0) + tok.get("cache_read", 0) + tok.get("cache_write_1h", 0) + tok.get("cache_write_5m", 0)
    agent_chars = merged_results.get("Agent", {}).get("chars", 0) + merged_results.get("Task", {}).get("chars", 0)
    return {
        "session": session_id or os.path.splitext(os.path.basename(transcript))[0],
        "calls": main["calls"],
        "tokens": tok,
        "cache_hit": round(tok.get("cache_read", 0) / inputs, 3) if inputs else 0,
        "cost_index": round(cost_index(tok), 1),
        "tools": {k: v for k, v in sorted(merged_results.items(), key=lambda kv: -kv[1]["chars"])},
        "biggest": [{"chars": c, "tool": n, "what": w} for c, n, w in sorted(biggest, reverse=True)[:8]],
        "rereads": {f: n for f, n in reads.most_common(10) if n > 1},
        "full_big_reads": sorted(set(full_big)),
        "subagents": dict(sub, cost_index=round(sub["cost_index"], 1), report_chars=agent_chars),
    }


def cost_index(tok):
    return sum(tok.get(k, 0) * w for k, w in WEIGHTS.items()) / 1000.0


def log_path(root):
    return os.path.join(root, kit_config.STORAGE_DIR, "sessions", "usage.jsonl")


def config_dir():
    return os.environ.get("CLAUDE_CONFIG_DIR") or os.path.join(kit_config.home(), ".claude")


def current_transcript(root):
    import re
    slug = re.sub(r"[^A-Za-z0-9]", "-", root)
    files = glob.glob(os.path.join(config_dir(), "projects", slug, "*.jsonl"))
    return max(files, key=os.path.getmtime) if files else None


def advice(s):
    tips = []
    tools = s["tools"]
    total = sum(v["chars"] for v in tools.values()) or 1
    top = next(iter(tools.items()), None)
    if s["full_big_reads"]:
        tips.append(f"{len(s['full_big_reads'])} قراءة كاملة لملف ≥{BIG_READ_LINES} سطر: استخدم Grep أو offset/limit (`read_budget` بيمنعها)")
    if s["rereads"]:
        f, n = next(iter(s["rereads"].items()))
        tips.append(f"ملفات اتقرت أكتر من مرة ({len(s['rereads'])}): أكترها `{os.path.basename(f)}` ×{n}")
    if top and top[1]["chars"] / total > 0.5:
        tips.append(f"`{top[0]}` لوحده {round(100 * top[1]['chars'] / total)}% من نتايج الأدوات")
    if s["subagents"]["report_chars"] > 20000:
        tips.append("تقارير الـ subagents طويلة: حدّد طول التقرير في التكليف (rules/subagents.md)")
    t = s["tokens"]
    inputs = t.get("input", 0) + t.get("cache_read", 0) + t.get("cache_write_1h", 0) + t.get("cache_write_5m", 0)
    avg = inputs / s["calls"] if s["calls"] else 0
    if s["calls"] > 60 and avg > 120000:
        tips.append(f"الجلسة طويلة ({s['calls']} طلب، متوسط {fmt_k(int(avg))} توكن context لكل طلب): "
                    "كل طلب بيعيد إرسال كل اللي فات. جلسة لكل مهمة، أو `/compact` بين المراحل، أرخص بكتير")
    if s["cache_hit"] and s["cache_hit"] < 0.7 and s["calls"] > 10:
        tips.append(f"نسبة الـ cache {round(100 * s['cache_hit'])}% بس: تغيير الموديل أو الـ effort في نص الجلسة بيكسر الـ cache")
    return tips


def fmt_k(n):
    return f"{n / 1000:.1f}k" if n >= 1000 else str(n)


def print_report(sessions):
    if not sessions:
        print("مفيش جلسات متسجلة لسه. بتتسجل تلقائياً في آخر كل جلسة.")
        return
    print("| الجلسة | طلبات | input (cache %) | output | مؤشر التكلفة | subagents |")
    print("|---|---|---|---|---|---|")
    for s in sessions:
        t = s["tokens"]
        inputs = t.get("input", 0) + t.get("cache_read", 0) + t.get("cache_write_1h", 0) + t.get("cache_write_5m", 0)
        print(f"| {s['session'][:8]} | {s['calls']} | {fmt_k(inputs)} ({round(100 * s['cache_hit'])}%) | "
              f"{fmt_k(t.get('output', 0))} | {s['cost_index']} | {s['subagents']['count']} ({s['subagents']['cost_index']}) |")
    agg = collections.defaultdict(lambda: {"calls": 0, "chars": 0})
    for s in sessions:
        for k, v in s["tools"].items():
            agg[k]["calls"] += v["calls"]
            agg[k]["chars"] += v["chars"]
    total = sum(v["chars"] for v in agg.values()) or 1
    print("\n**نتايج الأدوات اللي بتكبّر الـ context** (بتتبعت تاني في كل دور بعدها):\n")
    print("| الأداة | مرات | حروف | % |")
    print("|---|---|---|---|")
    for k, v in sorted(agg.items(), key=lambda kv: -kv[1]["chars"])[:8]:
        print(f"| {k} | {v['calls']} | {fmt_k(v['chars'])} | {round(100 * v['chars'] / total)}% |")
    last = sessions[-1]
    if last["biggest"]:
        print("\n**أكبر نتايج في آخر جلسة:**\n")
        for b in last["biggest"][:5]:
            print(f"- {fmt_k(b['chars'])} · {b['tool']} · `{b['what']}`")
    tips = advice(last)
    if tips:
        print("\n**فين ممكن نوفّر:**\n")
        for t in tips:
            print(f"- {t}")


def main():
    args = sys.argv[1:]
    cmd = args[0] if args else "report"
    if cmd == "record":
        try:
            payload = json.load(sys.stdin)
        except Exception:
            return 0
        root = kit_config.project_root(payload.get("cwd"))
        tp = payload.get("transcript_path")
        if not root or not tp or not kit_config.enabled("usage_meter", root):
            return 0
        s = summarize(os.path.expanduser(tp), payload.get("session_id"))
        if not s or not s["calls"]:
            return 0
        path = log_path(root)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(s, ensure_ascii=False) + "\n")
        return 0
    if cmd == "report":
        root = kit_config.project_root()
        sessions = []
        if "--current" in args:
            tp = current_transcript(root) if root else None
            s = summarize(tp) if tp else None
            sessions = [s] if s else []
        elif root and os.path.isfile(log_path(root)):
            n = 10
            if "--last" in args:
                try:
                    n = int(args[args.index("--last") + 1])
                except (IndexError, ValueError):
                    pass
            with open(log_path(root), encoding="utf-8") as fh:
                for line in fh:
                    try:
                        sessions.append(json.loads(line))
                    except Exception:
                        pass
            sessions = sessions[-n:]
        if "--json" in args:
            print(json.dumps({"sessions": sessions, "advice": advice(sessions[-1]) if sessions else []},
                             ensure_ascii=False, indent=1))
        else:
            print_report(sessions)
        return 0
    print(__doc__.strip(), file=sys.stderr)
    return 2


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        sys.exit(0)
