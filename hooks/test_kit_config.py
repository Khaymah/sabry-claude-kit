"""Tests for the profile layer: kit_profile.py CLI, merge order, and hooks honouring switches."""
import json
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))


def env_for(home):
    env = {k: v for k, v in os.environ.items() if not k.startswith("SABRY_KIT_")}
    env.update(HOME=home, USERPROFILE=home)
    return env


def call(script, args=(), stdin="{}", env=None, cwd=None):
    p = subprocess.run([sys.executable, os.path.join(HERE, script)] + list(args), input=stdin,
                       capture_output=True, text=True, env=env, cwd=cwd, timeout=60)
    return p.returncode, p.stdout.strip(), p.stderr.strip()


class ProfileTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = os.path.join(self.tmp.name, "home")
        self.repo = os.path.join(self.tmp.name, "repo")
        os.makedirs(self.home)
        os.makedirs(self.repo)
        subprocess.run(["git", "-C", self.repo, "init", "-q"], check=True)
        self.env = env_for(self.home)

    def tearDown(self):
        self.tmp.cleanup()

    def show(self):
        return json.loads(call("kit_profile.py", ["show"], env=self.env, cwd=self.repo)[1])

    def test_no_profile_means_defaults(self):
        data = self.show()
        self.assertFalse(data["exists"])
        self.assertTrue(data["profile"]["settings"]["commit_style"])
        self.assertFalse(data["profile"]["settings"]["deal_economics"])

    def test_set_merges_and_project_overrides_user(self):
        call("kit_profile.py", ["set", '{"name":"Mona","settings":{"sounds":false}}'], env=self.env, cwd=self.repo)
        call("kit_profile.py", ["set", '{"language":"en"}'], env=self.env, cwd=self.repo)
        call("kit_profile.py", ["set", "--project", '{"settings":{"sounds":true,"comment_discipline":false}}'],
             env=self.env, cwd=self.repo)
        p = self.show()["profile"]
        self.assertEqual((p["name"], p["language"]), ("Mona", "en"))
        self.assertTrue(p["settings"]["sounds"], "project file wins over user file")
        self.assertFalse(p["settings"]["comment_discipline"])
        self.assertTrue(os.path.isfile(os.path.join(self.repo, ".agents", "profile.json")))

    def test_invalid_json_rejected_without_writing(self):
        rc, _, err = call("kit_profile.py", ["set", "{nope"], env=self.env, cwd=self.repo)
        self.assertEqual(rc, 2)
        self.assertFalse(os.path.exists(os.path.join(self.home, ".agents", "profile.json")))

    def test_render_lists_switched_off_rules(self):
        call("kit_profile.py", ["set", '{"name":"Ali","mode":"direct","settings":{"commit_style":false}}'],
             env=self.env, cwd=self.repo)
        out = call("kit_profile.py", ["render"], env=self.env, cwd=self.repo)[1]
        self.assertIn("Ali", out)
        self.assertIn("direct: implement", out)
        self.assertIn("English commits without AI attribution", out)

    def test_context_file_is_referenced_not_inlined(self):
        call("kit_profile.py", ["set", '{"name":"Ali"}'], env=self.env, cwd=self.repo)
        call("kit_profile.py", ["context", "# goals\nsecret-plan-xyz"], env=self.env, cwd=self.repo)
        out = call("kit_profile.py", ["render"], env=self.env, cwd=self.repo)[1]
        self.assertIn("profile.md", out)
        self.assertNotIn("secret-plan-xyz", out)

    def commit_payload(self):
        trailer = "Co-Authored-By: " + "Claude <noreply@anthropic.com>"
        return json.dumps({"tool_name": "Bash", "cwd": self.repo,
                           "tool_input": {"command": 'git commit -m "feat: x\n\n%s"' % trailer}})

    def test_hook_runs_by_default(self):
        out = call("enforce-commit-style.py", stdin=self.commit_payload(), env=self.env)[1]
        self.assertIn('"deny"', out)

    def test_hook_silent_when_switched_off_in_profile(self):
        call("kit_profile.py", ["set", '{"settings":{"commit_style":false}}'], env=self.env, cwd=self.repo)
        self.assertEqual(call("enforce-commit-style.py", stdin=self.commit_payload(), env=self.env)[1], "")

    def test_env_switch_beats_profile(self):
        env = dict(self.env, SABRY_KIT_COMMIT_STYLE="0")
        self.assertEqual(call("enforce-commit-style.py", stdin=self.commit_payload(), env=env)[1], "")

    def test_comment_hook_honours_switch(self):
        payload = json.dumps({"tool_name": "Write", "cwd": self.repo,
                              "tool_input": {"file_path": os.path.join(self.repo, "a.ts"),
                                             "content": "// note\nconst a = 1\n"}})
        self.assertIn('"deny"', call("enforce-comment-discipline.py", stdin=payload, env=self.env)[1])
        call("kit_profile.py", ["set", '{"settings":{"comment_discipline":false}}'], env=self.env, cwd=self.repo)
        self.assertEqual(call("enforce-comment-discipline.py", stdin=payload, env=self.env)[1], "")


if __name__ == "__main__":
    unittest.main()
