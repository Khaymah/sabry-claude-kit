"""Tests for usage.py against a synthetic transcript shaped like Claude Code's."""
import json
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
USAGE = os.path.join(HERE, "usage.py")


def assistant(mid, usage, tool=None):
    content = [{"type": "text", "text": "ok"}]
    if tool:
        content = [{"type": "tool_use", "id": tool[0], "name": tool[1], "input": tool[2]}]
    return {"type": "assistant", "message": {"id": mid, "usage": usage, "content": content}}


def result(tid, text):
    return {"type": "user", "message": {"content": [{"type": "tool_result", "tool_use_id": tid, "content": text}]}}


U = {"input_tokens": 10, "cache_read_input_tokens": 9000, "cache_creation_input_tokens": 1000,
     "cache_creation": {"ephemeral_1h_input_tokens": 1000, "ephemeral_5m_input_tokens": 0}, "output_tokens": 200}
BIG = "\n".join(f"line {i}" for i in range(900))


def lines():
    return [
        assistant("m1", U, ("t1", "Read", {"file_path": "/p/big.ts"})),
        assistant("m1", U),
        result("t1", BIG),
        assistant("m2", U, ("t2", "Read", {"file_path": "/p/big.ts", "offset": 1, "limit": 50})),
        result("t2", "x" * 100),
        assistant("m3", U, ("t3", "Bash", {"command": "npm test"})),
        result("t3", "y" * 3000),
        assistant("m4", U, ("t4", "Agent", {"description": "scan"})),
        result("t4", "z" * 500),
    ]


class UsageTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = os.path.join(self.tmp.name, "home")
        self.repo = os.path.join(self.tmp.name, "repo")
        os.makedirs(self.repo)
        subprocess.run(["git", "-C", self.repo, "init", "-q"], check=True)
        self.transcript = os.path.join(self.tmp.name, "s1.jsonl")
        with open(self.transcript, "w") as fh:
            for l in lines():
                fh.write(json.dumps(l) + "\n")
        sub = os.path.join(self.tmp.name, "s1", "subagents")
        os.makedirs(sub)
        with open(os.path.join(sub, "agent-a.jsonl"), "w") as fh:
            fh.write(json.dumps(assistant("s1", U)) + "\n")
        self.env = {k: v for k, v in os.environ.items() if not k.startswith("SABRY_KIT_")}
        self.env.update(HOME=self.home, USERPROFILE=self.home)

    def tearDown(self):
        self.tmp.cleanup()

    def run_usage(self, *args, stdin=""):
        return subprocess.run([sys.executable, USAGE] + list(args), input=stdin, capture_output=True,
                              text=True, env=self.env, cwd=self.repo, timeout=60)

    def record(self):
        return self.run_usage("record", stdin=json.dumps(
            {"transcript_path": self.transcript, "session_id": "s1", "cwd": self.repo}))

    def sessions(self):
        return json.loads(self.run_usage("report", "--json").stdout)["sessions"]

    def test_counts_each_api_call_once(self):
        self.record()
        s = self.sessions()[0]
        self.assertEqual(s["calls"], 4, "m1 has two transcript lines but is one API call")
        self.assertEqual(s["tokens"]["output"], 800)
        self.assertEqual(s["tokens"]["cache_write_1h"], 4000)
        self.assertAlmostEqual(s["cache_hit"], 36000 / (36040 + 4000), places=3)

    def test_tool_results_and_waste(self):
        self.record()
        s = self.sessions()[0]
        self.assertEqual(next(iter(s["tools"])), "Read", "largest result first")
        self.assertEqual(s["tools"]["Bash"]["chars"], 3000)
        self.assertEqual(s["rereads"], {"/p/big.ts": 2})
        self.assertEqual(s["full_big_reads"], ["/p/big.ts"], "the ranged read is not counted")
        self.assertEqual(s["subagents"]["count"], 1)
        self.assertEqual(s["subagents"]["report_chars"], 500)

    def test_report_text_has_advice(self):
        self.record()
        out = self.run_usage("report").stdout
        self.assertIn("| s1 |", out)
        self.assertIn("big.ts", out)

    def test_switch_off_records_nothing(self):
        self.env["SABRY_KIT_USAGE_METER"] = "0"
        self.record()
        self.assertEqual(self.sessions(), [])

    def test_bad_input_is_silent(self):
        p = self.run_usage("record", stdin="nope")
        self.assertEqual((p.returncode, p.stdout), (0, ""))
        p = self.run_usage("record", stdin=json.dumps({"transcript_path": "/missing.jsonl", "cwd": self.repo}))
        self.assertEqual(p.returncode, 0)


if __name__ == "__main__":
    unittest.main()
