"""Tests for lessons.py in a throwaway HOME and project: a correction recorded in one
session shows up in the next one, once, and only where it applies."""
import json
import os
import subprocess
import sys
import tempfile
import unittest
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "lessons.py")


class LessonsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = os.path.join(self.tmp.name, "home")
        self.proj = os.path.join(self.tmp.name, "proj")
        os.makedirs(self.home)
        self.make_project(self.proj)
        self.env = {k: v for k, v in os.environ.items()
                    if not k.startswith("SABRY_KIT_") and k not in ("CLAUDE_CONFIG_DIR", "CLAUDE_PROJECT_DIR")}
        self.env.update(HOME=self.home, USERPROFILE=self.home)

    def tearDown(self):
        self.tmp.cleanup()

    def make_project(self, path):
        os.makedirs(path)
        subprocess.run(["git", "init", "-q", path], capture_output=True, timeout=30)

    def read(self, path):
        with open(path, encoding="utf-8") as fh:
            return fh.read()

    def cli(self, *args, cwd=None):
        p = subprocess.run([sys.executable, SCRIPT, "--cwd", cwd or self.proj] + list(args),
                           capture_output=True, text=True, env=self.env, timeout=60, stdin=subprocess.DEVNULL)
        self.assertEqual(p.returncode, 0, p.stderr)
        return p.stdout

    def hook(self, mode, payload, *extra, env=None):
        payload.setdefault("cwd", self.proj)
        payload.setdefault("session_id", "s1")
        e = dict(self.env)
        e.update(env or {})
        p = subprocess.run([sys.executable, SCRIPT, mode] + list(extra), input=json.dumps(payload),
                           capture_output=True, text=True, env=e, timeout=60)
        self.assertEqual(p.returncode, 0, p.stderr)
        if not p.stdout.strip():
            return ""
        return json.loads(p.stdout)["hookSpecificOutput"]["additionalContext"]

    def add(self, right, **kw):
        args = ["add", "--right", right]
        cwd = kw.pop("cwd", None)
        for key, value in kw.items():
            args += ["--global"] if key == "owner_wide" else ["--" + key, value]
        return self.cli(*args, cwd=cwd)

    def bash(self, command, session="s1"):
        return self.hook("--match", {"tool_name": "Bash", "tool_input": {"command": command}, "session_id": session})

    def edit(self, rel, session="s1"):
        return self.hook("--match", {"tool_name": "Edit", "session_id": session,
                                     "tool_input": {"file_path": os.path.join(self.proj, rel)}})

    def test_correction_prompt_asks_for_a_lesson(self):
        for prompt in ("غلط، قلتلك استخدم bun", "مش كده خالص", "That's wrong, I told you to use bun",
                       "not what I asked for"):
            out = self.hook("--prompt", {"prompt": prompt})
            self.assertIn("lessons.py", out, prompt)
            self.assertIn("add --when", out, prompt)

    def test_ordinary_prompt_is_silent(self):
        for prompt in ("ضيف صفحة تسجيل الدخول", "add a login page", "/sabry-kit:kit-setup wrong", "x" * 2000 + " wrong"):
            self.assertEqual(self.hook("--prompt", {"prompt": prompt}), "", prompt[:40])

    def test_general_lesson_shows_once_at_the_start_of_the_next_session(self):
        out = self.add("Use bun, never npm", when="installing packages", wrong="ran npm install")
        self.assertIn("recorded in", out)
        text = self.read(os.path.join(self.proj, ".agents", "memory", "lessons.md"))
        self.assertRegex(text, r"- \[\d{4}-\d{2}-\d{2}\] when: installing packages \| wrong: ran npm install \| right: Use bun, never npm")
        first = self.hook("--prompt", {"prompt": "ضيف صفحة", "session_id": "s2"})
        self.assertIn("Use bun, never npm", first)
        self.assertIn("ran npm install", first)
        self.assertEqual(self.hook("--prompt", {"prompt": "كمّل", "session_id": "s2"}), "")
        self.assertIn("Use bun", self.hook("--prompt", {"prompt": "hi", "session_id": "s3"}))

    def test_scoped_lesson_waits_for_its_file_or_command(self):
        self.add("Push to main directly, no feature branch", commands="git push, re:git\\s+checkout\\s+-b")
        self.add("Money is integer cents", files="src/billing/**, *.sql")
        start = self.hook("--prompt", {"prompt": "hi"})
        self.assertNotIn("Money is integer", start)
        self.assertEqual(self.bash("ls -la"), "")
        self.assertIn("Push to main directly", self.bash("git push -u origin main"))
        self.assertEqual(self.bash("git push"), "", "once per session")
        self.assertIn("Push to main", self.bash("git checkout  -b feat/x", session="other"))
        self.assertEqual(self.edit("src/app/page.tsx"), "")
        self.assertIn("integer cents", self.edit("src/billing/invoice/total.ts"))
        self.assertIn("integer cents", self.edit("db/migrations/001.sql", session="other"))

    def test_all_flag_lists_scoped_lessons_up_front(self):
        self.add("Money is integer cents", files="src/billing/**")
        out = self.hook("--prompt", {"prompt": "hi"}, "--all")
        self.assertIn("integer cents", out)
        self.assertIn("src/billing/**", out)

    def test_duplicate_is_not_recorded_twice(self):
        self.add("Use bun, never npm")
        self.assertIn("already in", self.add("use bun,  never NPM"))
        self.assertEqual(len(json.loads(self.cli("list", "--json"))), 1)

    def test_lesson_seen_in_two_projects_becomes_owner_wide(self):
        other = os.path.join(self.tmp.name, "other")
        self.make_project(other)
        self.add("Reply with a table, not paragraphs")
        self.assertFalse(os.path.exists(os.path.join(self.home, ".agents", "lessons.md")))
        out = self.add("Reply with a table, not paragraphs", cwd=other)
        self.assertIn("every project", out)
        third = os.path.join(self.tmp.name, "third")
        self.make_project(third)
        self.assertIn("Reply with a table", self.hook("--prompt", {"prompt": "hi", "cwd": third}))

    def test_global_flag_and_bundle(self):
        self.assertIn("every project", self.add("Never use Docker unless the client asks", owner_wide=True))
        self.assertFalse(os.path.exists(os.path.join(self.proj, ".agents", "memory", "lessons.md")))
        with open(os.path.join(self.home, ".agents", "profile.json"), "w") as fh:
            json.dump({"name": "Mona"}, fh)
        p = subprocess.run([sys.executable, os.path.join(HERE, "kit_profile.py"), "bundle"],
                           capture_output=True, text=True, env=self.env, timeout=60, stdin=subprocess.DEVNULL)
        self.assertEqual(p.returncode, 0, p.stderr)
        with zipfile.ZipFile(os.path.join(self.home, ".agents", "sabry-profile.zip")) as z:
            self.assertIn("Never use Docker", z.read("sabry-profile/lessons.md").decode("utf-8"))

    def test_synced_profile_skill_lessons_are_read(self):
        skill = os.path.join(self.home, ".claude", "skills", "sabry-profile")
        os.makedirs(skill)
        with open(os.path.join(skill, "profile.json"), "w") as fh:
            json.dump({"name": "Mona"}, fh)
        with open(os.path.join(skill, "lessons.md"), "w") as fh:
            fh.write("# Lessons\n\n- [2026-01-01] right: Commit messages in English\n")
        self.assertIn("Commit messages in English", self.hook("--prompt", {"prompt": "hi"}))

    def test_overflow_and_prune_archive_old_lessons(self):
        path = os.path.join(self.proj, ".agents", "memory", "lessons.md")
        os.makedirs(os.path.dirname(path))
        with open(path, "w") as fh:
            fh.write("# Lessons\n\n" + "".join(
                f"- [2020-01-{i:02d}] right: old rule number {i} about topic {i * 7919}\n" for i in range(1, 29)) + "".join(
                f"- [2020-02-{i:02d}] right: older rule number {i} on subject {i * 104729}\n" for i in range(1, 13)))
        self.add("A brand new rule that is unlike the others")
        archive = os.path.join(os.path.dirname(path), "lessons-archive.md")
        self.assertIn("old rule number 1 ", self.read(archive))
        self.assertEqual(len(json.loads(self.cli("list", "--json"))), 40)
        self.assertIn("archived 39", self.cli("prune", "--days", "30"))
        left = json.loads(self.cli("list", "--json"))
        self.assertEqual([l["right"] for l in left], ["A brand new rule that is unlike the others"])

    def test_lessons_come_back_after_compaction(self):
        self.add("Use bun, never npm")
        self.add("Push to main directly", commands="git push")
        start = lambda source: self.hook("--start", {"source": source})
        self.assertIn("Use bun", start("startup"))
        self.assertEqual(self.hook("--prompt", {"prompt": "hi"}), "", "already shown at session start")
        self.assertIn("Push to main", self.bash("git push"))
        self.assertEqual(self.bash("git push"), "")
        self.assertEqual(start("resume"), "", "a resume keeps the context")
        self.assertIn("Use bun", start("compact"))
        self.assertIn("Push to main", self.bash("git push"), "scoped lessons match again after a compaction")
        self.assertIn("Use bun", start("clear"))

    def test_switch_off(self):
        self.add("Use bun, never npm")
        self.assertEqual(self.hook("--prompt", {"prompt": "غلط"}, env={"SABRY_KIT_LESSONS": "0"}), "")

    def test_bad_input_never_fails(self):
        p = subprocess.run([sys.executable, SCRIPT, "--match"], input="{not json", capture_output=True,
                           text=True, env=self.env, timeout=60)
        self.assertEqual((p.returncode, p.stdout), (0, ""))


if __name__ == "__main__":
    unittest.main()
