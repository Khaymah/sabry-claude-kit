"""Tests for stop-reminders.py: several end-of-turn reminders reach the model as one note."""
import json
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "stop-reminders.py")
PLAN = "# Billing\n\n- Status: active\n\n## Phase 1\n- [ ] invoices table\n"


class StopRemindersTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = os.path.join(self.tmp.name, "home")
        self.proj = os.path.join(self.tmp.name, "proj")
        os.makedirs(self.home)
        os.makedirs(self.proj)
        subprocess.run(["git", "init", "-q", self.proj], capture_output=True, timeout=30)
        self.env = {k: v for k, v in os.environ.items()
                    if not k.startswith("SABRY_KIT_") and k not in ("CLAUDE_CONFIG_DIR", "CLAUDE_PROJECT_DIR")}
        self.env.update(HOME=self.home, USERPROFILE=self.home, CLAUDE_CONFIG_DIR=os.path.join(self.home, ".claude"))
        self.transcript = os.path.join(self.tmp.name, "t.jsonl")

    def tearDown(self):
        self.tmp.cleanup()

    def edit(self, *paths):
        with open(self.transcript, "w", encoding="utf-8") as fh:
            for path in paths:
                fh.write(json.dumps({"type": "assistant", "message": {"content": [
                    {"type": "tool_use", "name": "Edit", "input": {"file_path": os.path.join(self.proj, path)}}]}}) + "\n")

    def plan(self):
        path = os.path.join(self.proj, ".agents", "plans", "billing", "plan.md")
        os.makedirs(os.path.dirname(path))
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(PLAN)

    def stop(self, session="s1", env=None, **extra):
        payload = {"cwd": self.proj, "session_id": session, "transcript_path": self.transcript,
                   "hook_event_name": "Stop"}
        payload.update(extra)
        e = dict(self.env)
        e.update(env or {})
        p = subprocess.run([sys.executable, SCRIPT], input=json.dumps(payload), capture_output=True,
                           text=True, env=e, cwd=self.proj, timeout=120)
        self.assertEqual(p.returncode, 0, p.stderr)
        if not p.stdout.strip():
            return ""
        out = json.loads(p.stdout)
        self.assertEqual(out["hookSpecificOutput"]["hookEventName"], "Stop")
        return out["hookSpecificOutput"]["additionalContext"]

    def test_quiet_when_nothing_to_say(self):
        self.edit()
        self.assertEqual(self.stop(), "")

    def test_two_reminders_arrive_as_one_note(self):
        self.plan()
        self.edit("src/a.ts")
        text = self.stop()
        self.assertIn("[verify-reminder]", text)
        self.assertIn("[plan]", text)
        self.assertIn("ONE short addition", text)
        self.assertEqual(self.stop(), "", "neither repeats for the same change")

    def test_all_three_reminders_merge_into_one_note(self):
        git = lambda *a: subprocess.run(["git", "-C", self.proj] + list(a), capture_output=True, text=True,
                                        env=self.env, timeout=30)
        git("config", "user.email", "t@t.t")
        git("config", "user.name", "t")
        os.makedirs(os.path.join(self.proj, "src", "auth"))
        with open(os.path.join(self.proj, "base.ts"), "w") as fh:
            fh.write("export const b = 1\n")
        git("add", "-A")
        git("commit", "-qm", "base")
        subprocess.run([sys.executable, os.path.join(HERE, "team-review-reminder.py"), "--baseline"],
                       input="{}", capture_output=True, text=True, env=self.env, cwd=self.proj, timeout=60)
        self.plan()
        for name in ("src/auth/login.ts", "src/a.ts", "src/b.ts"):
            with open(os.path.join(self.proj, name), "w") as fh:
                fh.write("export const x = 1\n")
        self.edit("src/auth/login.ts", "src/a.ts", "src/b.ts")
        text = self.stop()
        for tag in ("[verify-reminder]", "[plan]", "[team-review]"):
            self.assertIn(tag, text)
        self.assertEqual(text.count("ONE short addition"), 1)

    def test_single_reminder_passes_through_unchanged(self):
        self.edit("src/a.ts")
        text = self.stop()
        self.assertTrue(text.startswith("[verify-reminder]"))
        self.assertNotIn("ONE short addition", text)

    def test_each_reminder_keeps_its_own_switch(self):
        self.plan()
        self.edit("src/a.ts")
        text = self.stop(env={"SABRY_KIT_VERIFY_REMINDER": "0"})
        self.assertNotIn("[verify-reminder]", text)
        self.assertIn("[plan]", text)

    def test_loop_protection_and_bad_input(self):
        self.plan()
        self.edit("src/a.ts")
        self.assertEqual(self.stop(stop_hook_active=True), "")
        p = subprocess.run([sys.executable, SCRIPT], input="{not json", capture_output=True, text=True,
                           env=self.env, timeout=60)
        self.assertEqual((p.returncode, p.stdout), (0, ""))


if __name__ == "__main__":
    unittest.main()
