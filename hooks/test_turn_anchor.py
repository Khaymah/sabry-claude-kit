"""Tests for turn-anchor.py: the owner's basics ride with every prompt, and an English reply is corrected."""
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "turn-anchor.py")
ENGLISH = ("I implemented the three changes and ran the test suite. All eight tests pass now. The redeem "
           "function uses an atomic check before it writes, so twenty parallel requests cannot pass the "
           "limit. Next I can add validation for the limit field or remove the delay from the store.")
ARABIC = ("نفّذت التلات تعديلات وشغّلت الاختبارات، والتمانية نجحوا. دالة redeem بقت بتتحقق وتكتب مرة واحدة، "
          "فعشرين طلب في نفس اللحظة مايعدّوش الحد. الخطوة الجاية أضيف تحقق على limit أو أشيل التأخير من الـ store.")


class TurnAnchorTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = os.path.join(self.tmp.name, "home")
        self.proj = os.path.join(self.tmp.name, "proj")
        os.makedirs(os.path.join(self.home, ".agents"))
        os.makedirs(self.proj)
        self.env = {k: v for k, v in os.environ.items()
                    if not k.startswith("SABRY_KIT_") and k not in ("CLAUDE_CONFIG_DIR", "CLAUDE_PROJECT_DIR")}
        self.env.update(HOME=self.home, USERPROFILE=self.home, CLAUDE_CONFIG_DIR=os.path.join(self.home, ".claude"))
        self.transcript = os.path.join(self.tmp.name, "t.jsonl")

    def tearDown(self):
        self.tmp.cleanup()

    def profile(self, **fields):
        with open(os.path.join(self.home, ".agents", "profile.json"), "w", encoding="utf-8") as fh:
            json.dump(fields, fh)

    def reply(self, *texts, sidechain_last=None):
        with open(self.transcript, "w", encoding="utf-8") as fh:
            for text in texts:
                fh.write(json.dumps({"type": "assistant", "message": {"content": [{"type": "text", "text": text}]}},
                                    ensure_ascii=False) + "\n")
                fh.write(json.dumps({"type": "user", "message": {"content": "ok"}}) + "\n")
            if sidechain_last:
                fh.write(json.dumps({"type": "assistant", "isSidechain": True,
                                     "message": {"content": [{"type": "text", "text": sidechain_last}]}}) + "\n")

    def run_hook(self, **env):
        payload = {"hook_event_name": "UserPromptSubmit", "cwd": self.proj, "transcript_path": self.transcript,
                   "prompt": "كمّل"}
        p = subprocess.run([sys.executable, SCRIPT], input=json.dumps(payload), capture_output=True, text=True,
                           encoding="utf-8", env=dict(self.env, **env), timeout=30)
        self.assertEqual(p.returncode, 0, p.stderr)
        return json.loads(p.stdout)["hookSpecificOutput"]["additionalContext"] if p.stdout.strip() else ""

    def test_anchor_carries_the_basics(self):
        self.profile(language="ar-eg", mode="cto-pm")
        text = self.run_hook()
        for part in ("Egyptian Arabic", "AskUserQuestion", "نفّذ", "no AI attribution"):
            self.assertIn(part, text)
        self.assertLess(len(text), 400)

    def test_direct_mode_and_assume_drop_their_parts(self):
        self.profile(language="en", mode="direct", questions="assume")
        text = self.run_hook()
        self.assertIn("Reply in English", text)
        self.assertNotIn("AskUserQuestion", text)
        self.assertNotIn("نفّذ", text)

    def test_english_reply_is_corrected(self):
        self.profile(language="ar-eg")
        self.reply(ARABIC, ENGLISH)
        self.assertIn("last reply was in English", self.run_hook())

    def test_arabic_reply_with_code_is_not_flagged(self):
        self.profile(language="ar-eg")
        self.reply(ENGLISH, ARABIC + "\n```js\n" + "export async function redeem(code) { return code }\n" * 20 + "```")
        self.assertNotIn("last reply was in English", self.run_hook())

    def test_short_english_reply_is_not_flagged(self):
        self.profile(language="ar-eg")
        self.reply("Done. Tests pass.")
        self.assertNotIn("last reply was in English", self.run_hook())

    def test_subagent_text_is_ignored(self):
        self.profile(language="ar-eg")
        self.reply(ARABIC, sidechain_last=ENGLISH)
        self.assertNotIn("last reply was in English", self.run_hook())

    def test_english_profile_is_never_corrected(self):
        self.profile(language="en")
        self.reply(ENGLISH)
        self.assertNotIn("last reply was in English", self.run_hook())

    def write_entries(self, *entries):
        with open(self.transcript, "w", encoding="utf-8") as fh:
            for entry in entries:
                fh.write(json.dumps(entry, ensure_ascii=False) + "\n")

    def test_string_content_and_text_next_to_tool_use(self):
        self.profile(language="ar-eg")
        self.write_entries({"type": "assistant", "message": {"content": ENGLISH}})
        self.assertIn("last reply was in English", self.run_hook())
        self.write_entries({"type": "assistant", "message": {"content": [
            {"type": "text", "text": ENGLISH}, {"type": "tool_use", "name": "Bash", "input": {"command": "ls"}}]}})
        self.assertIn("last reply was in English", self.run_hook())

    def test_large_transcript_reads_only_the_tail(self):
        self.profile(language="ar-eg")
        filler = json.dumps({"type": "user", "message": {"content": "x" * 1000}}) + "\n"
        with open(self.transcript, "w", encoding="utf-8") as fh:
            fh.write(filler * 3000)
            fh.write(json.dumps({"type": "assistant", "message": {"content": [{"type": "text", "text": ENGLISH}]}}) + "\n")
        self.assertIn("last reply was in English", self.run_hook())

    def test_long_blob_is_fast(self):
        self.profile(language="ar-eg")
        self.reply(ARABIC + " " + "A" * 200000)
        started = time.monotonic()
        self.run_hook()
        self.assertLess(time.monotonic() - started, 3)

    def test_arabic_words_with_slashes_still_count(self):
        self.profile(language="ar-eg")
        self.reply("راجعت الملفات/المجلدات بتاريخ 2026/11/19 " + ARABIC + " deploy build release " * 5)
        self.assertNotIn("last reply was in English", self.run_hook())

    def test_bad_payloads_never_break(self):
        self.profile(language="ar-eg")
        for raw in ("[]", "not json", json.dumps({"cwd": self.proj, "transcript_path": 42})):
            p = subprocess.run([sys.executable, SCRIPT], input=raw, capture_output=True, text=True,
                               encoding="utf-8", env=self.env, timeout=30)
            self.assertEqual(p.returncode, 0, p.stderr)
        p = subprocess.run([sys.executable, SCRIPT], input=json.dumps({"cwd": self.proj, "transcript_path": 42}),
                           capture_output=True, text=True, encoding="utf-8", env=self.env, timeout=30)
        self.assertIn("Egyptian Arabic", p.stdout)

    def test_missing_transcript_and_switch_off(self):
        self.profile(language="ar-eg")
        self.assertIn("Egyptian Arabic", self.run_hook())
        self.assertEqual(self.run_hook(SABRY_KIT_TURN_ANCHOR="0"), "")


if __name__ == "__main__":
    unittest.main()
