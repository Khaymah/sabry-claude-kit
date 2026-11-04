"""Tests for doctor.py: each conflict is detected, fixes apply, and undo restores the
exact original state. Runs against a fake HOME / CLAUDE_CONFIG_DIR."""
import json
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
KIT = os.path.dirname(HERE)
DOCTOR = os.path.join(HERE, "doctor.py")
TRAILER = "Co-Authored-By: " + "Claude <noreply@anthropic.com>"


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text if isinstance(text, str) else json.dumps(text, indent=2))


class DoctorTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = os.path.join(self.tmp.name, "home")
        self.cfg = os.path.join(self.home, ".claude")
        self.repo = os.path.join(self.tmp.name, "repo")
        os.makedirs(self.repo)
        subprocess.run(["git", "-C", self.repo, "init", "-q"], check=True)
        self.env = {k: v for k, v in os.environ.items() if not k.startswith("SABRY_KIT_")}
        self.env.update(HOME=self.home, USERPROFILE=self.home, CLAUDE_CONFIG_DIR=self.cfg)
        write(os.path.join(self.home, ".agents", "profile.json"), {"cost_profile": "economy"})
        self.settings = {
            "attribution": {"commit": "🤖 Generated with Claude Code", "pr": ""},
            "autoMemoryEnabled": False,
            "effortLevel": "xhigh",
            "autoCompactWindow": 500000,
            "env": {"CLAUDE_CODE_MAX_OUTPUT_TOKENS": "64000", "KEEP": "1"},
            "hooks": {
                "PreToolUse": [
                    {"matcher": "Agent|Task", "hooks": [{"type": "command", "command": "python enforce-model.py"}]},
                    {"matcher": "Bash", "hooks": [
                        {"type": "command", "command": "python", "args": ["C:\\Users\\X\\.claude\\hooks\\enforce-commit-style.py"]},
                        {"type": "command", "command": "my-own-linter"}]},
                ],
            },
        }
        write(os.path.join(self.cfg, "settings.json"), self.settings)
        with open(os.path.join(self.cfg, "settings.json")) as fh:
            self.original_settings = fh.read()
        plug = os.path.join(self.cfg, "plugins", "cache", "acme", "notes", "1.0.0")
        write(os.path.join(plug, ".claude-plugin", "plugin.json"), {"name": "notes", "version": "1.0.0"})
        write(os.path.join(plug, "skills", "remember", "SKILL.md"),
              "---\nname: remember\n---\nAlways update MEMORY.md with what you learned.\n")
        write(os.path.join(plug, "skills", "ship", "SKILL.md"), f"End every commit with\n{TRAILER}\n")
        write(os.path.join(plug, "skills", "team-review", "SKILL.md"), "---\nname: team-review\n---\nreview\n")
        write(os.path.join(plug, "hooks", "hooks.json"),
              {"hooks": {"SessionStart": [{"hooks": [{"type": "command", "command": "echo hi"}]}]}})
        old_kit = os.path.join(self.cfg, "plugins", "cache", "mirror", "sabry-kit", "0.0.1")
        write(os.path.join(old_kit, ".claude-plugin", "plugin.json"), {"name": "sabry-kit", "version": "0.0.1"})
        write(os.path.join(old_kit, "hooks", "hooks.json"),
              {"hooks": {"PreToolUse": [{"matcher": "Agent|Task", "hooks": [{"type": "command", "command": "enforce-opus.py"}]}]}})
        write(os.path.join(self.cfg, "agents", "cto.md"), "---\nname: cto\n---\nold copy\n")
        write(os.path.join(self.cfg, "CLAUDE.md"), f"Rules\n- Always add JSDoc comments to functions\n")
        os.symlink(os.path.join(KIT, "skills"), os.path.join(self.cfg, "skills"))

    def tearDown(self):
        self.tmp.cleanup()

    def doctor(self, *args):
        p = subprocess.run([sys.executable, DOCTOR] + list(args), capture_output=True, text=True,
                           env=self.env, cwd=self.repo, timeout=60, stdin=subprocess.DEVNULL)
        return p.returncode, p.stdout, p.stderr

    def settings_now(self):
        with open(os.path.join(self.cfg, "settings.json")) as fh:
            return json.load(fh)

    def scan(self):
        rc, out, err = self.doctor("scan", "--json")
        self.assertEqual(rc, 0, err)
        return {f["id"]: f for f in json.loads(out)}

    def test_detects_each_conflict(self):
        ids = self.scan()
        expected = ["model-hook:user:PreToolUse:0:0", "dup-hook:user:PreToolUse:1:0", "attribution:user",
                    "automemory-off:user", "cost-knobs", "kit-copy:sabry-kit@mirror",
                    "plugin-memory:notes@acme", "plugin-attribution:notes@acme",
                    "plugin-session-context:notes@acme", "dup-agents:cto", "kit-symlink:skills"]
        for fid in expected:
            self.assertIn(fid, ids, f"missing {fid}; got {sorted(ids)}")
        self.assertTrue(any(f.startswith("claude-md:") for f in ids), sorted(ids))
        self.assertEqual(ids["dup-hook:user:PreToolUse:1:0"]["severity"], "high", "machine path → high")
        self.assertNotIn("my-own-linter", json.dumps([f for f in ids.values() if f["id"].startswith(("dup-hook", "model-hook"))]))

    def test_command_name_clashes(self):
        ids = self.scan()
        self.assertIn("name-clash:team-review:notes@acme", ids)
        self.assertFalse([i for i in ids if i.startswith("name-builtin:")],
                         "a kit skill shares its name with a built-in command")

    def test_switched_off_rule_is_not_a_conflict(self):
        write(os.path.join(self.home, ".agents", "profile.json"), {"settings": {"commit_style": False}})
        ids = self.scan()
        self.assertNotIn("attribution:user", ids)
        self.assertNotIn("plugin-attribution:notes@acme", ids)

    def test_fix_all_then_undo_restores_everything(self):
        rc, out, err = self.doctor("fix", "--all-safe")
        result = json.loads(out)
        self.assertTrue(result["fixed"], out)
        s = self.settings_now()
        self.assertEqual(s["attribution"], {"commit": "", "pr": ""})
        self.assertNotIn("autoMemoryEnabled", s)
        self.assertEqual(s["effortLevel"], "medium")
        self.assertEqual(s["env"]["CLAUDE_CODE_MAX_OUTPUT_TOKENS"], "32000")
        self.assertEqual(s["env"]["KEEP"], "1", "unrelated keys survive")
        cmds = json.dumps(s.get("hooks"))
        self.assertNotIn("enforce-model", cmds)
        self.assertNotIn("enforce-commit-style", cmds)
        self.assertIn("my-own-linter", cmds, "the owner's own hook survives")
        self.assertIs(s["enabledPlugins"]["notes@acme"], False)
        self.assertIs(s["enabledPlugins"]["sabry-kit@mirror"], False)
        self.assertFalse(os.path.exists(os.path.join(self.cfg, "agents", "cto.md")), "quarantined")
        self.assertFalse(os.path.lexists(os.path.join(self.cfg, "skills")), "symlink removed")
        self.assertNotIn("dup-agents:cto", self.scan())

        rc, out, err = self.doctor("undo")
        self.assertEqual(rc, 0, err)
        with open(os.path.join(self.cfg, "settings.json")) as fh:
            self.assertEqual(fh.read(), self.original_settings)
        self.assertTrue(os.path.isfile(os.path.join(self.cfg, "agents", "cto.md")))
        self.assertTrue(os.path.islink(os.path.join(self.cfg, "skills")))
        rc, out, _ = self.doctor("undo")
        self.assertEqual(rc, 1, "nothing left to undo")

    def test_fix_one_id_touches_nothing_else(self):
        self.doctor("fix", "attribution:user")
        s = self.settings_now()
        self.assertEqual(s["attribution"], {"commit": "", "pr": ""})
        self.assertIs(s.get("autoMemoryEnabled"), False)
        self.assertTrue(os.path.isfile(os.path.join(self.cfg, "agents", "cto.md")))

    def test_brief_once_a_day_only_for_high(self):
        p = subprocess.run([sys.executable, DOCTOR, "brief"], input="{}", capture_output=True, text=True,
                           env=self.env, cwd=self.repo, timeout=60)
        self.assertIn("/sabry-kit:kit-doctor", p.stdout)
        p = subprocess.run([sys.executable, DOCTOR, "brief"], input="{}", capture_output=True, text=True,
                           env=self.env, cwd=self.repo, timeout=60)
        self.assertEqual(p.stdout.strip(), "", "second run the same day is silent")

    def test_manual_findings_are_never_auto_fixed(self):
        rc, out, _ = self.doctor("fix", "--all-safe")
        with open(os.path.join(self.cfg, "CLAUDE.md")) as fh:
            self.assertIn("Always add JSDoc", fh.read())


if __name__ == "__main__":
    unittest.main()
