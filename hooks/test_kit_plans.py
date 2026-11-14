"""Tests for kit_plans.py: a new session continues from the first unchecked item, the
Stop hook asks for the boxes once per change, and state survives a compaction."""
import json
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "kit_plans.py")
BRIEF = os.path.join(HERE, "project-brief.py")

PLAN = """# Billing module

- Status: {status}
- Goal: invoices and payments

## Phase 1: Schema
Acceptance: migration runs
- [x] invoices table
- [{second}] payments table

## Phase 2: API
Acceptance: endpoints tested
- [ ] POST /invoices
- [ ] GET /invoices/:id
"""


class PlansTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = os.path.join(self.tmp.name, "home")
        self.proj = os.path.join(self.tmp.name, "proj")
        os.makedirs(self.home)
        os.makedirs(self.proj)
        subprocess.run(["git", "init", "-q", self.proj], capture_output=True, timeout=30)
        self.env = {k: v for k, v in os.environ.items()
                    if not k.startswith("SABRY_KIT_") and k not in ("CLAUDE_CONFIG_DIR", "CLAUDE_PROJECT_DIR")}
        self.env.update(HOME=self.home, USERPROFILE=self.home)
        self.plan_path = os.path.join(self.proj, ".agents", "plans", "billing-module", "plan.md")
        self.transcript = os.path.join(self.tmp.name, "t.jsonl")

    def tearDown(self):
        self.tmp.cleanup()

    def write_plan(self, status="active", second=" ", path=None):
        path = path or self.plan_path
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(PLAN.format(status=status, second=second))

    def write_transcript(self, *events):
        with open(self.transcript, "w", encoding="utf-8") as fh:
            for kind, value in events:
                if kind == "edit":
                    msg = {"type": "assistant", "message": {"content": [
                        {"type": "tool_use", "name": "Edit", "input": {"file_path": value}}]}}
                else:
                    msg = {"type": "user", "message": {"content": value}}
                fh.write(json.dumps(msg) + "\n")

    def run_script(self, script, args, payload=None, env=None):
        e = dict(self.env)
        e.update(env or {})
        p = subprocess.run([sys.executable, script] + list(args), capture_output=True, text=True, env=e,
                           timeout=60, cwd=self.proj,
                           input=json.dumps(payload) if payload is not None else None,
                           stdin=None if payload is not None else subprocess.DEVNULL)
        self.assertEqual(p.returncode, 0, p.stderr)
        return p.stdout.strip()

    def hook(self, mode, env=None, **extra):
        payload = {"cwd": self.proj, "session_id": "s1", "transcript_path": self.transcript}
        payload.update(extra)
        out = self.run_script(SCRIPT, [mode], payload, env)
        return json.loads(out)["hookSpecificOutput"]["additionalContext"] if out else ""

    def brief(self):
        out = self.run_script(BRIEF, [], {"cwd": self.proj, "session_id": "s9"})
        return json.loads(out)["hookSpecificOutput"]["additionalContext"] if out else ""

    def src(self, name):
        return os.path.join(self.proj, "src", name)

    def test_new_creates_a_plan_the_parser_reads(self):
        out = self.run_script(SCRIPT, ["new", "Billing module", "--goal", "invoices",
                                       "--phase", "Schema :: migration runs", "--phase", "API :: endpoints tested"])
        self.assertIn(".agents/plans/billing-module/plan.md", out)
        status = json.loads(self.run_script(SCRIPT, ["status", "--json"]))
        self.assertEqual((status[0]["total"], status[0]["active"], status[0]["next"]),
                         (2, True, "Phase 1: Schema → <task>"))

    def test_new_session_brief_points_at_the_first_unchecked_item(self):
        self.write_plan()
        text = self.brief()
        self.assertIn("Active plan `.agents/plans/billing-module/plan.md` (1/4 done)", text)
        self.assertIn("next → Phase 1: Schema → payments table", text)
        self.write_plan(second="x")
        self.assertIn("(2/4 done) · next → Phase 2: API → POST /invoices", self.brief())

    def test_closed_or_finished_plans_are_not_active(self):
        self.write_plan(status="paused")
        self.assertNotIn("Active plan", self.brief())
        self.write_plan(status="done")
        self.assertNotIn("Active plan", self.brief())
        with open(self.plan_path, "w") as fh:
            fh.write("# T\n- Status: active\n## P\n- [x] a\n")
        self.assertNotIn("Active plan", self.brief())

    def test_stop_asks_for_boxes_once_per_change(self):
        self.write_plan()
        self.write_transcript(("edit", self.src("a.ts")))
        first = self.hook("--stop")
        self.assertIn("1/4", first)
        self.assertIn("payments table", first)
        self.assertEqual(self.hook("--stop"), "", "same change is not flagged twice")
        self.write_transcript(("edit", self.src("a.ts")), ("edit", self.src("b.ts")))
        self.assertIn("[plan]", self.hook("--stop"))

    def test_stop_is_quiet_when_the_plan_was_updated_last_or_nothing_changed(self):
        self.write_plan()
        self.write_transcript(("edit", self.src("a.ts")), ("edit", self.plan_path))
        self.assertEqual(self.hook("--stop"), "")
        self.write_transcript(("user", "hi"))
        self.assertEqual(self.hook("--stop"), "")
        self.write_transcript(("edit", self.src("a.ts")))
        self.assertEqual(self.hook("--stop", stop_hook_active=True), "")
        os.remove(self.plan_path)
        self.assertEqual(self.hook("--stop"), "")

    def test_state_survives_compaction(self):
        self.write_plan()
        self.write_transcript(("user", "كمّل المرحلة التانية"), ("edit", self.src("a.ts")),
                              ("user", "<system-reminder>ignore</system-reminder>"))
        with open(os.path.join(self.proj, "dirty.txt"), "w") as fh:
            fh.write("x")
        self.assertEqual(self.hook("--precompact", trigger="auto"), "")
        self.assertEqual(self.hook("--start", source="startup"), "", "only after a compaction")
        text = self.hook("--start", source="compact")
        self.assertIn("compacted", text)
        self.assertIn("billing-module/plan.md` (1/4 done)", text)
        self.assertIn("Next: Phase 1: Schema → payments table", text)
        self.assertIn("src/a.ts", text)
        self.assertIn("dirty.txt", text)
        self.assertIn("كمّل المرحلة التانية", text)
        self.assertNotIn("system-reminder", text)
        self.assertEqual(self.hook("--start", source="compact", session_id="other"), "")

    def test_switch_off(self):
        self.write_plan()
        self.write_transcript(("edit", self.src("a.ts")))
        off = {"SABRY_KIT_LONG_TASK_PLANS": "0"}
        self.assertEqual(self.hook("--stop", env=off), "")
        out = self.run_script(BRIEF, [], {"cwd": self.proj}, off)
        self.assertNotIn("Active plan", out)

    def test_bad_input_never_fails(self):
        p = subprocess.run([sys.executable, SCRIPT, "--stop"], input="{not json", capture_output=True,
                           text=True, env=self.env, timeout=60)
        self.assertEqual((p.returncode, p.stdout), (0, ""))


if __name__ == "__main__":
    unittest.main()
