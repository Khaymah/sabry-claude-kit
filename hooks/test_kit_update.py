"""Tests for kit_update.py: an owner with an existing profile hears about an update once,
their choices are not rewritten, and stale installs in other tools are named."""
import json
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "kit_update.py")
KIT = os.path.dirname(HERE)
with open(os.path.join(KIT, ".claude-plugin", "plugin.json"), encoding="utf-8") as fh:
    CURRENT = json.load(fh)["version"]


class KitUpdateTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = self.tmp.name
        self.env = {k: v for k, v in os.environ.items()
                    if not k.startswith("SABRY_KIT_") and k != "CLAUDE_CONFIG_DIR"}
        self.env.update(HOME=self.home, USERPROFILE=self.home)
        os.makedirs(os.path.join(self.home, ".agents"))
        self.profile = os.path.join(self.home, ".agents", "profile.json")

    def tearDown(self):
        self.tmp.cleanup()

    def write_profile(self, data):
        with open(self.profile, "w", encoding="utf-8") as fh:
            json.dump(data, fh)

    def read_profile(self):
        with open(self.profile, encoding="utf-8") as fh:
            return json.load(fh)

    def run_script(self, *args, env=None):
        e = dict(self.env)
        e.update(env or {})
        p = subprocess.run([sys.executable, SCRIPT] + list(args), input="{}", capture_output=True,
                           text=True, env=e, timeout=60)
        self.assertEqual(p.returncode, 0, p.stderr)
        return p.stdout.strip()

    def notice(self, env=None):
        out = self.run_script(env=env)
        return json.loads(out)["hookSpecificOutput"]["additionalContext"] if out else ""

    def test_old_profile_hears_once_and_keeps_its_choices(self):
        old = {"name": "Mona", "updated": "2026-01-01T10:00:00", "settings": {"sounds": False}}
        self.write_profile(old)
        text = self.notice()
        self.assertIn(f"sabry-kit is now {CURRENT}", text)
        self.assertIn("saved with 0.2.0", text)
        self.assertIn("`lessons`", text)
        self.assertIn("`long_task_plans`", text)
        self.assertIn("kit-setup", text)
        saved = self.read_profile()
        self.assertEqual(saved["kit_version"], CURRENT)
        self.assertEqual({k: v for k, v in saved.items() if k != "kit_version"}, old, "nothing else is rewritten")
        self.assertEqual(self.notice(), "", "once per version")

    def test_new_switches_are_on_without_any_migration(self):
        self.write_profile({"name": "Mona", "settings": {"sounds": False}})
        code = ("import sys; sys.path.insert(0, %r); import kit_config; "
                "print(kit_config.enabled('lessons'), kit_config.enabled('long_task_plans'), kit_config.enabled('sounds'))" % HERE)
        p = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, env=self.env, timeout=60)
        self.assertEqual(p.stdout.split(), ["True", "True", "False"], p.stderr)

    def test_quiet_without_a_profile_or_when_current(self):
        self.assertEqual(self.notice(), "")
        self.write_profile({"name": "Mona", "kit_version": CURRENT})
        self.assertEqual(self.notice(), "")
        self.write_profile({"name": "Mona", "kit_version": "99.0.0"})
        self.assertEqual(self.notice(), "")

    def test_quiet_when_the_profile_is_only_the_synced_skill(self):
        skill = os.path.join(self.home, ".claude", "skills", "sabry-profile")
        os.makedirs(skill)
        with open(os.path.join(skill, "profile.json"), "w") as fh:
            json.dump({"name": "Mona"}, fh)
        self.assertEqual(self.notice(), "")

    def test_pre_release_versions_sort_before_the_release(self):
        sys.path.insert(0, HERE)
        import kit_update
        self.assertLess(kit_update.parse("0.3.0-rc1"), kit_update.parse("0.3.0"))
        self.assertLess(kit_update.parse("0.3.0-beta.2"), kit_update.parse("0.3.0"))
        self.assertLess(kit_update.parse("0.2.9"), kit_update.parse("0.3.0-rc1"))
        self.assertEqual(kit_update.parse("v0.3.0"), kit_update.parse("0.3.0"))

    def test_malformed_profile_shapes_do_not_crash(self):
        self.write_profile({"name": "Mona", "settings": [1, 2]})
        json.loads(self.run_script("status"))
        self.assertIn("sabry-kit is now", self.notice())

    def test_stale_installs_are_named(self):
        self.write_profile({"name": "Mona"})
        with open(os.path.join(self.home, ".agents", "sabry-kit-install.json"), "w") as fh:
            json.dump({"codex": {"files": []}, "kimi": {"files": [], "version": CURRENT}}, fh)
        text = self.notice()
        self.assertIn("--target codex", text)
        self.assertNotIn("--target kimi", text)
        status = json.loads(self.run_script("status"))
        self.assertEqual(status["stale_installs"], ["codex"])
        self.assertEqual(status["kit"], CURRENT)

    def test_switch_off_and_status_reports_owner_choices(self):
        self.write_profile({"name": "Mona", "settings": {"lessons": False}})
        self.assertEqual(self.notice(env={"SABRY_KIT_UPDATE_NOTICE": "0"}), "")
        self.assertNotIn("kit_version", self.read_profile())
        status = json.loads(self.run_script("status"))
        self.assertEqual(status["switched_off_by_owner"], ["lessons"])
        self.assertEqual(status["profile_saved_with"], "0.2.0")

    def test_install_and_profile_commands_record_the_version(self):
        p = subprocess.run([sys.executable, os.path.join(HERE, "kit_profile.py"), "set", '{"name":"Mona"}'],
                           capture_output=True, text=True, env=self.env, timeout=60, stdin=subprocess.DEVNULL)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(self.read_profile()["kit_version"], CURRENT)
        self.assertEqual(self.notice(), "", "a profile saved by this version needs no notice")
        p = subprocess.run([sys.executable, os.path.join(HERE, "kit_install.py"), "--target", "cline"],
                           capture_output=True, text=True, env=self.env, timeout=120, stdin=subprocess.DEVNULL)
        self.assertEqual(p.returncode, 0, p.stderr)
        with open(os.path.join(self.home, ".agents", "sabry-kit-install.json")) as fh:
            self.assertEqual(json.load(fh)["cline"]["version"], CURRENT)


if __name__ == "__main__":
    unittest.main()
