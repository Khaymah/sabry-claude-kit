"""Tests for read-budget.py and verify-reminder.py."""
import json
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))


def call(script, payload, env):
    p = subprocess.run([sys.executable, os.path.join(HERE, script)], input=json.dumps(payload),
                       capture_output=True, text=True, env=env, timeout=60)
    return p.returncode, p.stdout.strip()


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = os.path.join(self.tmp.name, "home")
        self.repo = os.path.join(self.tmp.name, "repo")
        os.makedirs(self.home)
        os.makedirs(self.repo)
        subprocess.run(["git", "-C", self.repo, "init", "-q"], check=True)
        self.env = {k: v for k, v in os.environ.items() if not k.startswith("SABRY_KIT_")}
        self.env.update(HOME=self.home, USERPROFILE=self.home)

    def tearDown(self):
        self.tmp.cleanup()

    def file(self, name, lines):
        path = os.path.join(self.repo, name)
        with open(path, "w") as fh:
            fh.write("\n".join(f"line {i}" for i in range(lines)) + "\n")
        return path


class ReadBudgetTest(Base):
    def read(self, **ti):
        return call("read-budget.py", {"tool_name": "Read", "cwd": self.repo, "tool_input": ti}, self.env)

    def test_large_full_read_denied_with_guidance(self):
        rc, out = self.read(file_path=self.file("big.ts", 1200))
        reason = json.loads(out)["hookSpecificOutput"]["permissionDecisionReason"]
        self.assertIn("big.ts", reason)
        self.assertIn("limit", reason)

    def test_small_file_allowed(self):
        self.assertEqual(self.read(file_path=self.file("small.ts", 300))[1], "")

    def test_ranged_or_explicit_limit_allowed(self):
        big = self.file("big.ts", 1200)
        self.assertEqual(self.read(file_path=big, offset=100, limit=50)[1], "")
        self.assertEqual(self.read(file_path=big, limit=5000)[1], "", "explicit limit = deliberate full read")

    def test_binary_and_missing_pass(self):
        img = os.path.join(self.repo, "a.png")
        with open(img, "wb") as fh:
            fh.write(b"\x89PNG\0" + b"\n" * 5000)
        self.assertEqual(self.read(file_path=img)[1], "")
        self.assertEqual(self.read(file_path=os.path.join(self.repo, "nope.ts"))[1], "")

    def test_switch_and_threshold_from_profile(self):
        big = self.file("big.ts", 1200)
        os.makedirs(os.path.join(self.home, ".agents"))
        with open(os.path.join(self.home, ".agents", "profile.json"), "w") as fh:
            json.dump({"settings": {"read_budget_lines": 2000}}, fh)
        self.assertEqual(self.read(file_path=big)[1], "")
        self.env["SABRY_KIT_READ_BUDGET"] = "0"
        with open(os.path.join(self.home, ".agents", "profile.json"), "w") as fh:
            json.dump({}, fh)
        self.assertEqual(self.read(file_path=big)[1], "")


class VerifyReminderTest(Base):
    def transcript(self, steps):
        path = os.path.join(self.tmp.name, "t.jsonl")
        with open(path, "w") as fh:
            for i, (tool, inp) in enumerate(steps):
                fh.write(json.dumps({"type": "assistant", "message": {"id": f"m{i}", "content": [
                    {"type": "tool_use", "id": f"t{i}", "name": tool, "input": inp}]}}) + "\n")
        return path

    def stop(self, steps, last="done", session="s1", **extra):
        payload = {"hook_event_name": "Stop", "session_id": session, "cwd": self.repo,
                   "transcript_path": self.transcript(steps), "last_assistant_message": last}
        payload.update(extra)
        return call("verify-reminder.py", payload, self.env)[1]

    def edit(self, name="src/a.ts"):
        return ("Edit", {"file_path": os.path.join(self.repo, name), "old_string": "a", "new_string": "b"})

    def test_code_edit_without_check_reminds_with_project_scripts(self):
        with open(os.path.join(self.repo, "package.json"), "w") as fh:
            json.dump({"scripts": {"test": "vitest", "typecheck": "tsc", "dev": "next"}}, fh)
        out = self.stop([self.edit()])
        ctx = json.loads(out)["hookSpecificOutput"]["additionalContext"]
        self.assertIn("src/a.ts", ctx)
        self.assertIn("npm run test", ctx)
        self.assertIn("npm run typecheck", ctx)
        self.assertNotIn("npm run dev", ctx)

    def test_check_after_edit_is_quiet(self):
        self.assertEqual(self.stop([self.edit(), ("Bash", {"command": "bun test src/a.test.ts"})]), "")

    def test_edit_after_check_reminds(self):
        self.assertIn("verify-reminder", self.stop([("Bash", {"command": "npx tsc --noEmit"}), self.edit()]))

    def test_docs_only_is_quiet(self):
        self.assertEqual(self.stop([self.edit("README.md"), self.edit("config.json")]), "")

    def test_admitted_in_reply_is_quiet(self):
        self.assertEqual(self.stop([self.edit()], last="خلصت، بس ما اتحققتش لأن مفيش اختبارات"), "")
        self.assertEqual(self.stop([self.edit()], last="Done. Not verified: no test suite.", session="s2"), "")

    def test_once_per_change_set_and_loop_guard(self):
        steps = [self.edit()]
        self.assertTrue(self.stop(steps))
        self.assertEqual(self.stop(steps), "", "same change-set: silent")
        self.assertEqual(self.stop(steps, session="s3", stop_hook_active=True), "")

    def test_switch_off(self):
        self.env["SABRY_KIT_VERIFY_REMINDER"] = "0"
        self.assertEqual(self.stop([self.edit()]), "")


if __name__ == "__main__":
    unittest.main()
