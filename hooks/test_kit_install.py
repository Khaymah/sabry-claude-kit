"""Tests for kit_install.py against a throwaway HOME: nothing of the owner's is overwritten,
re-installing is idempotent, generated files are valid for each tool, uninstall is exact."""
import json
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
KIT = os.path.dirname(HERE)
SCRIPT = os.path.join(HERE, "kit_install.py")

try:
    import tomllib
except ImportError:
    tomllib = None


class InstallTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = self.tmp.name
        self.env = {k: v for k, v in os.environ.items()
                    if not k.startswith("SABRY_KIT_") and k not in ("CLAUDE_CONFIG_DIR", "CODEX_HOME", "KIMI_CODE_HOME")}
        self.env.update(HOME=self.home, USERPROFILE=self.home)

    def tearDown(self):
        self.tmp.cleanup()

    def run_install(self, *args):
        p = subprocess.run([sys.executable, SCRIPT] + list(args), capture_output=True, text=True,
                           env=self.env, cwd=self.home, timeout=120, stdin=subprocess.DEVNULL)
        self.assertEqual(p.returncode, 0, p.stderr)
        return json.loads(p.stdout)

    def path(self, *parts):
        return os.path.join(self.home, *parts)

    def read(self, *parts):
        with open(self.path(*parts), encoding="utf-8") as fh:
            return fh.read()

    def test_codex_install_is_valid_and_complete(self):
        report = self.run_install("--target", "codex")
        self.assertFalse(report["skipped"])
        text = self.read(".codex", "AGENTS.md")
        self.assertIn("sabry-kit:start", text)
        self.assertIn("Comment discipline", text)
        self.assertIn("AskUserQuestion", text)
        self.assertNotIn(".claude/Roles", text)
        agents = [f for f in os.listdir(self.path(".codex", "agents")) if f.endswith(".toml")]
        self.assertEqual(len(agents), len([f for f in os.listdir(os.path.join(KIT, "agents")) if f.endswith(".md")]))
        if tomllib:
            for fn in agents:
                with open(self.path(".codex", "agents", fn), "rb") as fh:
                    data = tomllib.load(fh)
                self.assertEqual(data["name"], fn[:-5])
                self.assertTrue(data["description"] and data["developer_instructions"].strip())
                self.assertNotIn("model", data, "unmapped tier leaves the tool default")
                self.assertNotIn(".claude/Roles", data["developer_instructions"])
        skill = self.read(".agents", "skills", "kit-setup", "SKILL.md")
        self.assertTrue(skill.startswith("---\nname: kit-setup"))
        self.assertIn("The kit folder is `" + KIT.replace("\\", "/"), skill)

    def test_kimi_agents_are_kebab_markdown_and_read_only_ones_are_denied_writes(self):
        self.run_install("--target", "kimi")
        folder = self.path(".kimi-code", "agents", "sabry-kit")
        names = sorted(os.listdir(folder))
        self.assertIn("frontend-developer.md", names)
        self.assertIn("database-optimizer.md", names)
        for fn in names:
            text = self.read(".kimi-code", "agents", "sabry-kit", fn)
            head = text.split("\n---", 1)[0]
            self.assertRegex(head, r"\nname: [a-z0-9]+(-[a-z0-9]+)*\n")
            self.assertRegex(head, r'\ndescription: ".+"')
        reviewer = self.read(".kimi-code", "agents", "sabry-kit", "code-reviewer.md")
        self.assertIn("disallowedTools:\n  - Write\n  - Edit", reviewer)
        engineer = self.read(".kimi-code", "agents", "sabry-kit", "senior-engineer.md")
        self.assertNotIn("disallowedTools", engineer)
        self.assertIn("sabry-kit:start", self.read(".kimi-code", "AGENTS.md"))

    def test_owner_content_is_never_overwritten(self):
        os.makedirs(self.path(".codex", "agents"))
        os.makedirs(self.path(".agents", "skills", "team-review"))
        with open(self.path(".codex", "AGENTS.md"), "w") as fh:
            fh.write("# My own rules\n\nAlways use tabs.\n")
        with open(self.path(".codex", "agents", "cto.toml"), "w") as fh:
            fh.write('name = "cto"\ndescription = "mine"\ndeveloper_instructions = "mine"\n')
        with open(self.path(".agents", "skills", "team-review", "SKILL.md"), "w") as fh:
            fh.write("mine\n")
        report = self.run_install("--target", "codex")
        self.assertEqual(len(report["skipped"]), 2, report["skipped"])
        md = self.read(".codex", "AGENTS.md")
        self.assertTrue(md.startswith("# My own rules\n\nAlways use tabs.\n"))
        self.assertIn("sabry-kit:start", md)
        self.assertIn('description = "mine"', self.read(".codex", "agents", "cto.toml"))
        self.assertEqual(self.read(".agents", "skills", "team-review", "SKILL.md"), "mine\n")

    def test_reinstall_is_idempotent(self):
        self.run_install("--target", "codex")
        first = self.read(".codex", "AGENTS.md")
        self.run_install("--target", "codex")
        second = self.read(".codex", "AGENTS.md")
        self.assertEqual(first, second)
        self.assertEqual(second.count("sabry-kit:start"), 1)

    def test_profile_and_model_tiers_flow_into_the_output(self):
        os.makedirs(self.path(".agents"))
        with open(self.path(".agents", "profile.json"), "w") as fh:
            json.dump({"name": "Mona", "settings": {"comment_discipline": False},
                       "providers": {"codex": {"tiers": {"strong": "big-model"}}}}, fh)
        report = self.run_install("--target", "codex")
        self.assertEqual(report["models"]["strong"], "big-model")
        md = self.read(".codex", "AGENTS.md")
        self.assertIn("Mona", md)
        self.assertNotIn("# Comment discipline", md)
        self.assertIn('model = "big-model"', self.read(".codex", "agents", "cto.toml"))
        self.assertNotIn("model =", self.read(".codex", "agents", "senior-pm.toml"))

    def run_installed(self, command, payload):
        p = subprocess.run(command, shell=True, input=json.dumps(payload), capture_output=True, text=True,
                           env=self.env, cwd=self.home, timeout=120)
        return p.stdout.strip()

    def bad_commit(self):
        trailer = "Co-Authored-By: " + "Claude <noreply@anthropic.com>"
        return {"hook_event_name": "PreToolUse", "tool_name": "Bash", "cwd": self.home,
                "tool_input": {"command": 'git commit -m "feat: x\n\n%s"' % trailer}}

    def test_codex_hooks_merge_run_and_uninstall(self):
        os.makedirs(self.path(".codex"))
        mine = {"hooks": {"PreToolUse": [{"matcher": "Bash", "hooks": [{"type": "command", "command": "my-linter"}]}]}}
        with open(self.path(".codex", "hooks.json"), "w") as fh:
            json.dump(mine, fh)
        self.run_install("--target", "codex")
        self.run_install("--target", "codex")
        data = json.loads(self.read(".codex", "hooks.json"))
        commands = [h["command"] for groups in data["hooks"].values() for g in groups for h in g["hooks"]]
        self.assertIn("my-linter", commands)
        ours = [c for c in commands if 'adapt.py" codex ' in c]
        self.assertEqual(len(ours), len(set(ours)), "no duplicates after a second install")
        self.assertEqual(len(ours), 9)
        commit_hook = next(c for c in ours if c.endswith("enforce-commit-style.py"))
        self.assertIn('"deny"', self.run_installed(commit_hook, self.bad_commit()))
        patch = {"hook_event_name": "PreToolUse", "tool_name": "apply_patch", "cwd": self.home, "tool_input": {
            "command": "*** Begin Patch\n*** Add File: src/a.ts\n+// note\n+export const a = 1\n*** End Patch"}}
        patch_hook = next(c for c in ours if c.endswith("enforce-comment-discipline.py"))
        self.assertIn('"deny"', self.run_installed(patch_hook, patch))
        patch["tool_input"]["command"] = "*** Begin Patch\n*** Add File: src/a.ts\n+export const a = 1\n*** End Patch"
        self.assertEqual(self.run_installed(patch_hook, patch), "")
        self.run_install("--target", "codex", "--uninstall")
        self.assertEqual(json.loads(self.read(".codex", "hooks.json")), mine)

    def test_kimi_hooks_block_in_config_toml(self):
        os.makedirs(self.path(".kimi-code"))
        with open(self.path(".kimi-code", "config.toml"), "w") as fh:
            fh.write('default_model = "x"\n\n[[hooks]]\nevent = "Stop"\ncommand = "my-hook"\n')
        self.run_install("--target", "kimi")
        self.run_install("--target", "kimi")
        text = self.read(".kimi-code", "config.toml")
        self.assertEqual(text.count("# >>> sabry-kit hooks"), 1)
        if tomllib:
            data = tomllib.loads(text)
            self.assertEqual(data["default_model"], "x")
            commands = [h["command"] for h in data["hooks"]]
            self.assertIn("my-hook", commands)
            for h in data["hooks"]:
                self.assertLessEqual(set(h), {"event", "matcher", "command", "timeout"}, "Kimi rejects other keys")
            commit_hook = next(c for c in commands if c.endswith("enforce-commit-style.py"))
            self.assertIn('"deny"', self.run_installed(commit_hook, self.bad_commit()))
            write_hook = next(c for c in commands if c.endswith("enforce-comment-discipline.py"))
            payload = {"hook_event_name": "PreToolUse", "tool_name": "Write", "cwd": self.home,
                       "tool_input": {"path": self.path("a.ts"), "content": "// x\nconst a = 1\n"}}
            self.assertIn('"deny"', self.run_installed(write_hook, payload))
        self.run_install("--target", "kimi", "--uninstall")
        rest = self.read(".kimi-code", "config.toml")
        self.assertNotIn("sabry-kit", rest)
        self.assertIn("my-hook", rest)

    def test_hooks_skipped_when_the_file_cannot_be_merged_safely(self):
        os.makedirs(self.path(".codex"))
        os.makedirs(self.path(".kimi-code"))
        with open(self.path(".codex", "hooks.json"), "w") as fh:
            fh.write("{not json")
        with open(self.path(".kimi-code", "config.toml"), "w") as fh:
            fh.write('hooks = []\n')
        self.assertTrue(any("hooks.json" in x for x in self.run_install("--target", "codex")["skipped"]))
        self.assertTrue(any("config.toml" in x for x in self.run_install("--target", "kimi")["skipped"]))
        self.assertEqual(self.read(".codex", "hooks.json"), "{not json")
        self.assertEqual(self.read(".kimi-code", "config.toml"), "hooks = []\n")

    def test_no_hooks_flag(self):
        self.run_install("--target", "codex", "--no-hooks")
        self.assertFalse(os.path.exists(self.path(".codex", "hooks.json")))

    def test_dry_run_writes_nothing(self):
        report = self.run_install("--target", "kimi", "--dry-run")
        self.assertTrue(report["written"])
        self.assertFalse(os.path.exists(self.path(".kimi-code")))
        self.assertFalse(os.path.exists(self.path(".agents")))

    def test_uninstall_removes_only_what_the_kit_wrote(self):
        os.makedirs(self.path(".codex"))
        with open(self.path(".codex", "AGENTS.md"), "w") as fh:
            fh.write("# My own rules\n")
        self.run_install("--target", "codex")
        self.run_install("--target", "kimi")
        self.run_install("--target", "codex", "--uninstall")
        self.assertEqual(self.read(".codex", "AGENTS.md").strip(), "# My own rules")
        self.assertEqual(os.listdir(self.path(".codex", "agents")), [])
        self.assertTrue(os.path.isdir(self.path(".agents", "skills", "kit-setup")), "still used by kimi")
        self.run_install("--target", "kimi", "--uninstall")
        self.assertFalse(os.path.exists(self.path(".agents", "skills", "kit-setup")))
        self.assertFalse(os.path.exists(self.path(".kimi-code", "AGENTS.md")), "kit-only file is removed")
        self.assertEqual(json.loads(self.read(".agents", "sabry-kit-install.json")), {})


if __name__ == "__main__":
    unittest.main()
