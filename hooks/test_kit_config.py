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

    def test_env_profile_used_when_no_file(self):
        env = dict(self.env, SABRY_KIT_PROFILE_JSON='{"name":"Cloudy","settings":{"sounds":false}}')
        data = json.loads(call("kit_profile.py", ["show"], env=env, cwd=self.repo)[1])
        self.assertTrue(data["exists"])
        self.assertEqual(data["profile"]["name"], "Cloudy")
        self.assertFalse(data["profile"]["settings"]["sounds"])
        call("kit_profile.py", ["set", "--project", '{"name":"Proj"}'], env=env, cwd=self.repo)
        data = json.loads(call("kit_profile.py", ["show"], env=env, cwd=self.repo)[1])
        self.assertEqual(data["profile"]["name"], "Proj", "project file wins over the env profile")

    def test_env_export_round_trips(self):
        call("kit_profile.py", ["set", '{"name":"Mona","language":"en"}'], env=self.env, cwd=self.repo)
        rc, out, _ = call("kit_profile.py", ["env"], env=self.env, cwd=self.repo)
        self.assertEqual(json.loads(out)["name"], "Mona")
        self.assertNotIn("\n", out)

    def synced_skill(self, profile, context=None):
        d = os.path.join(self.home, ".claude", "skills", "synced", "bucket-1", "sabry-profile")
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "profile.json"), "w", encoding="utf-8") as fh:
            json.dump(profile, fh)
        if context:
            with open(os.path.join(d, "profile.md"), "w", encoding="utf-8") as fh:
                fh.write(context)
        return d

    def test_synced_profile_skill_used_everywhere_without_setup(self):
        self.synced_skill({"name": "FromSkill", "updated": "2026-11-05T10:00:00"}, "# goals\n")
        env = dict(self.env, SABRY_KIT_PROFILE_JSON='{"name":"FromEnv"}')
        data = json.loads(call("kit_profile.py", ["show"], env=env, cwd=self.repo)[1])
        self.assertTrue(data["exists"])
        self.assertEqual(data["profile"]["name"], "FromSkill", "skill beats the env fallback")
        out = call("kit_profile.py", ["render"], env=env, cwd=self.repo)[1]
        self.assertIn(os.path.join("sabry-profile", "profile.md"), out, "context from the skill")

    def test_newer_of_local_file_and_skill_wins(self):
        self.synced_skill({"name": "FromSkill", "updated": "2020-01-01T00:00:00"})
        call("kit_profile.py", ["set", '{"name":"Local"}'], env=self.env, cwd=self.repo)
        name = json.loads(call("kit_profile.py", ["show"], env=self.env, cwd=self.repo)[1])["profile"]["name"]
        self.assertEqual(name, "Local", "a profile edited just now is newer than the old skill")
        self.synced_skill({"name": "FromSkill", "updated": "2999-01-01T00:00:00"})
        name = json.loads(call("kit_profile.py", ["show"], env=self.env, cwd=self.repo)[1])["profile"]["name"]
        self.assertEqual(name, "FromSkill")

    def test_bundle_is_an_uploadable_skill(self):
        import zipfile
        call("kit_profile.py", ["set", '{"name":"Mona"}'], env=self.env, cwd=self.repo)
        call("kit_profile.py", ["context", "# goals\nship"], env=self.env, cwd=self.repo)
        rc, out, err = call("kit_profile.py", ["bundle"], env=self.env, cwd=self.repo)
        self.assertEqual(rc, 0, err)
        with zipfile.ZipFile(out) as z:
            names = set(z.namelist())
            self.assertEqual(names, {"sabry-profile/SKILL.md", "sabry-profile/profile.json", "sabry-profile/profile.md"})
            skill = z.read("sabry-profile/SKILL.md").decode()
            self.assertEqual(json.loads(z.read("sabry-profile/profile.json"))["name"], "Mona")
        head = skill.split("---")[1]
        keys = [l.split(":", 1)[0] for l in head.strip().splitlines()]
        self.assertEqual(keys, ["name", "description"], "only keys claude.ai accepts")
        self.assertNotIn(": ", head.split("description:", 1)[1].strip()[:-1].replace("sabry-kit hooks", ""))

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
