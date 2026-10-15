import json
import os
import subprocess
import sys
import tempfile
import unittest

HOOK = os.path.join(os.path.dirname(os.path.abspath(__file__)), "inject-rules.py")


def run(config_dir, force=False):
    env = dict(os.environ, CLAUDE_CONFIG_DIR=config_dir)
    env.pop("SABRY_KIT_FORCE_INJECT", None)
    if force:
        env["SABRY_KIT_FORCE_INJECT"] = "1"
    out = subprocess.run([sys.executable, HOOK], env=env, capture_output=True, text=True, encoding="utf-8")
    return out.returncode, out.stdout.strip()


class InjectRulesTest(unittest.TestCase):
    def test_skips_when_native_rules_exist(self):
        with tempfile.TemporaryDirectory() as d:
            os.makedirs(os.path.join(d, "rules"))
            open(os.path.join(d, "rules", "x.md"), "w").close()
            self.assertEqual(run(d), (0, ""))

    def test_injects_when_no_native_rules(self):
        with tempfile.TemporaryDirectory() as d:
            code, out = run(d)
            self.assertEqual(code, 0)
            ctx = json.loads(out)["hookSpecificOutput"]["additionalContext"]
            self.assertIn("انضباط الكومنتات", ctx)

    def test_injects_when_rules_dir_has_no_markdown(self):
        with tempfile.TemporaryDirectory() as d:
            os.makedirs(os.path.join(d, "rules"))
            self.assertTrue(run(d)[1])

    def test_force_overrides_skip(self):
        with tempfile.TemporaryDirectory() as d:
            os.makedirs(os.path.join(d, "rules"))
            open(os.path.join(d, "rules", "x.md"), "w").close()
            self.assertTrue(run(d, force=True)[1])

    def test_injected_context_includes_every_rule_file(self):
        rules = os.path.join(os.path.dirname(os.path.dirname(HOOK)), "rules")
        with tempfile.TemporaryDirectory() as d:
            ctx = json.loads(run(d)[1])["hookSpecificOutput"]["additionalContext"]
        for name in sorted(os.listdir(rules)):
            if name.endswith(".md"):
                with open(os.path.join(rules, name), encoding="utf-8") as fh:
                    heading = next(l for l in fh if l.startswith("# "))
                self.assertIn(heading.strip(), ctx, name)


if __name__ == "__main__":
    unittest.main()
