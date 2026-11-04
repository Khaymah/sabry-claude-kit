"""Tests for project-brief.py on a synthetic Next.js + Drizzle repo."""
import json
import os
import subprocess
import sys
import tempfile
import unittest

HOOK = os.path.join(os.path.dirname(os.path.abspath(__file__)), "project-brief.py")


class BriefTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = os.path.join(self.tmp.name, "home")
        self.repo = os.path.join(self.tmp.name, "shop")
        os.makedirs(os.path.join(self.repo, "src", "app"))
        os.makedirs(os.path.join(self.repo, "node_modules", "x"))
        os.makedirs(os.path.join(self.repo, "Plan", "Progress"))
        os.makedirs(self.home)
        g = lambda *a: subprocess.run(["git", "-C", self.repo] + list(a), capture_output=True)
        g("init", "-q", "-b", "main")
        g("config", "user.email", "t@t.t")
        g("config", "user.name", "t")
        with open(os.path.join(self.repo, "package.json"), "w") as fh:
            json.dump({"dependencies": {"next": "^15.1.0", "react": "19.0.0", "drizzle-orm": "0.36"},
                       "devDependencies": {"vitest": "2", "typescript": "5"},
                       "scripts": {"dev": "next dev", "test": "vitest", "typecheck": "tsc", "lint": "eslint ."}}, fh)
        open(os.path.join(self.repo, "bun.lock"), "w").close()
        for i in range(3):
            open(os.path.join(self.repo, "src", "app", f"p{i}.tsx"), "w").close()
        open(os.path.join(self.repo, "node_modules", "x", "i.js"), "w").close()
        with open(os.path.join(self.repo, "Plan", "Progress", "2026-11-03.md"), "w", encoding="utf-8") as fh:
            fh.write("# 2026-11-03\n## 1. old\n- **الجاي:** old step\n## 2. cart\n- **الجاي:** اربط الـ checkout بـ Stripe\n- **مفتوح:** سعر الشحن\n")
        g("add", "-A")
        g("commit", "-q", "-m", "feat: cart page")
        self.env = {k: v for k, v in os.environ.items() if not k.startswith("SABRY_KIT_")}
        self.env.update(HOME=self.home, USERPROFILE=self.home)

    def tearDown(self):
        self.tmp.cleanup()

    def brief(self, env=None):
        p = subprocess.run([sys.executable, HOOK], input=json.dumps({"cwd": self.repo}), capture_output=True,
                           text=True, env=env or self.env, timeout=60)
        return json.loads(p.stdout)["hookSpecificOutput"]["additionalContext"] if p.stdout.strip() else ""

    def test_brief_content(self):
        b = self.brief()
        self.assertIn("branch `main`", b)
        self.assertIn("feat: cart page", b)
        for token in ("Bun", "Next.js 15.1.0", "React 19.0.0", "Drizzle", "Vitest", "TypeScript"):
            self.assertIn(token, b)
        self.assertIn("test `bun run test`", b)
        self.assertIn("typecheck `bun run typecheck`", b)
        self.assertIn("src/ (3)", b)
        self.assertNotIn("node_modules", b)
        self.assertIn("اربط الـ checkout بـ Stripe", b, "latest next step, not the old one")
        self.assertNotIn("old step", b)
        self.assertIn("سعر الشحن", b)
        self.assertLessEqual(len(b), 1500)

    def test_layout_cached(self):
        self.brief()
        self.assertTrue(os.path.isfile(os.path.join(self.repo, ".agents", "scratch", "brief-layout.json")))

    def test_switch_off(self):
        self.assertEqual(self.brief(dict(self.env, SABRY_KIT_PROJECT_BRIEF="0")), "")

    def test_home_dir_is_not_a_project(self):
        p = subprocess.run([sys.executable, HOOK], input=json.dumps({"cwd": self.home}), capture_output=True,
                           text=True, env=self.env, timeout=60)
        self.assertEqual(p.stdout.strip(), "")


if __name__ == "__main__":
    unittest.main()
