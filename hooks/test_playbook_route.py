"""Tests for playbook-route.py: requests reach the right playbooks, ordinary requests get none,
a playbook is not repeated in one session, and coding subagents get the playbooks of their brief."""
import json
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "playbook-route.py")
KIT = os.path.dirname(HERE)


class RouteTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.env = {k: v for k, v in os.environ.items() if not k.startswith("SABRY_KIT_")}
        self.env.update(HOME=self.tmp.name, USERPROFILE=self.tmp.name,
                        CLAUDE_CONFIG_DIR=os.path.join(self.tmp.name, ".claude"))

    def tearDown(self):
        self.tmp.cleanup()

    def run_hook(self, payload, *args, **env):
        payload = dict({"session_id": "s1", "cwd": self.tmp.name}, **payload)
        p = subprocess.run([sys.executable, SCRIPT, *args], input=json.dumps(payload, ensure_ascii=False),
                           capture_output=True, text=True, encoding="utf-8", env=dict(self.env, **env), timeout=30)
        self.assertEqual(p.returncode, 0, p.stderr)
        return json.loads(p.stdout)["hookSpecificOutput"]["additionalContext"] if p.stdout.strip() else ""

    def prompt(self, text, **env):
        return self.run_hook({"hook_event_name": "UserPromptSubmit", "prompt": text}, **env)

    def test_requests_reach_their_playbooks(self):
        cases = {
            "في الـ flash sale بعنا 9 قطع من منتج المخزون بتاعه كان 5": "backend/data/concurrency.md",
            "فيه آلاف محاولات تسجيل دخول فاشلة من IPs كتير": "backend/reliability/rate-limit.md",
            "صدّر كل الطلبات لملف CSV يفتح في إكسيل بالأسامي العربي": "backend/files/import-export.md",
            "عايز أعمل نسيت كلمة السر في الـ API": "backend/auth/password-reset.md",
            "Add a Paymob webhook that marks the order paid": "backend/reliability/idempotency.md",
            "عميل فتح مشروع شركة تانية في الـ SaaS": "backend/data/multi-tenancy.md",
        }
        for text, rel in cases.items():
            with self.subTest(text):
                self.assertIn(f"Playbooks/{rel}", self.prompt(text))

    def test_ordinary_requests_get_nothing(self):
        for text in ("اشرحلي الفرق بين let و const", "rename this variable", "الافتراضات المنطقية اذكرها",
                     "اكتب README للمشروع", "```ts\nexport async function Stock() {}\n```\nراجع ده"):
            with self.subTest(text):
                self.assertEqual(self.prompt(text), "")

    def test_injection_stays_small(self):
        text = self.prompt("webhook الدفع من Paymob بيخصم مرتين والسعر والكوبون والضريبة غلط")
        self.assertLessEqual(text.count("### "), 3)
        self.assertLess(len(text), 3 * 2700 + 800)

    def test_repeated_playbook_is_named_not_repeated(self):
        first = self.prompt("المخزون بيتباع أكتر من الموجود")
        again = self.prompt("لسه المخزون بيتباع أكتر")
        self.assertIn("Decision", first)
        self.assertNotIn("Decision", again)
        self.assertIn("given earlier this session", again)

    def test_coding_subagent_gets_its_brief_playbooks(self):
        brief = {"hook_event_name": "PreToolUse", "tool_name": "Agent",
                 "tool_input": {"subagent_type": "sabry-kit:senior-engineer", "description": "fix",
                                "prompt": "Fix the oversell race on stock in purchase()"}}
        self.assertEqual(self.run_hook(brief, "--agent"), "")
        text = self.run_hook({"hook_event_name": "SubagentStart", "agent_type": "sabry-kit:senior-engineer"}, "--subagent")
        self.assertIn("Playbooks/backend/data/concurrency.md", text)
        self.assertEqual(self.run_hook({"hook_event_name": "SubagentStart", "agent_type": "sabry-kit:proposal-writer"},
                                       "--subagent"), "")

    def test_routes_point_at_real_files(self):
        with open(os.path.join(KIT, "Playbooks", "routes.json"), encoding="utf-8") as fh:
            routes = json.load(fh)
        for rel in routes:
            if not rel.startswith("_"):
                self.assertTrue(os.path.isfile(os.path.join(KIT, "Playbooks", rel)), rel)

    def test_switch_off_and_bad_input(self):
        self.assertEqual(self.prompt("المخزون بيتباع أكتر", SABRY_KIT_PLAYBOOKS="0"), "")
        p = subprocess.run([sys.executable, SCRIPT], input="not json", capture_output=True, text=True, timeout=30)
        self.assertEqual((p.returncode, p.stdout), (0, ""))


if __name__ == "__main__":
    unittest.main()
