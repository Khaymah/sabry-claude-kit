import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest

HOOK = os.path.join(os.path.dirname(os.path.abspath(__file__)), "inject-rules.py")


RULE_SWITCHES = {"deal-economics.md", "code-tools.md", "framework-gotchas.md"}


def run(config_dir, force=False, profile=None, args=(), payload="{}"):
    env = {k: v for k, v in os.environ.items() if not k.startswith("SABRY_KIT_")}
    env.update(CLAUDE_CONFIG_DIR=config_dir, HOME=config_dir, USERPROFILE=config_dir)
    if profile is not None:
        path = os.path.join(config_dir, "profile.json")
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(profile, fh)
        env["SABRY_KIT_PROFILE"] = path
    if force:
        env["SABRY_KIT_FORCE_INJECT"] = "1"
    out = subprocess.run([sys.executable, HOOK] + list(args), env=env, input=payload, capture_output=True,
                         text=True, encoding="utf-8", timeout=60)
    return out.returncode, out.stdout.strip()


def ctx_of(out):
    return json.loads(out)["hookSpecificOutput"]["additionalContext"]


class InjectRulesTest(unittest.TestCase):
    def test_native_kit_rules_skip_rules_but_keep_profile_and_kit_path(self):
        kit_rules = os.path.join(os.path.dirname(os.path.dirname(HOOK)), "rules")
        with tempfile.TemporaryDirectory() as d:
            os.makedirs(os.path.join(d, "rules"))
            for name in os.listdir(kit_rules):
                open(os.path.join(d, "rules", name), "w").close()
            code, out = run(d)
            self.assertEqual(code, 0)
            ctx = ctx_of(out)
            self.assertIn("/sabry-kit:kit-setup", ctx)
            self.assertNotIn("Comment discipline", ctx)
            self.assertIn("Kit folder", ctx, "the kit path is needed even when the rules load natively")

    def test_owner_rules_of_their_own_do_not_switch_the_kit_rules_off(self):
        with tempfile.TemporaryDirectory() as d:
            os.makedirs(os.path.join(d, "rules"))
            open(os.path.join(d, "rules", "mine.md"), "w").close()
            self.assertIn("Comment discipline", ctx_of(run(d)[1]))

    def test_no_profile_nudges_setup_first(self):
        with tempfile.TemporaryDirectory() as d:
            ctx = ctx_of(run(d)[1])
            self.assertTrue(ctx.startswith("# ⚙️ sabry-kit"), ctx[:80])

    def test_profile_comes_first_with_top_priority(self):
        with tempfile.TemporaryDirectory() as d:
            ctx = ctx_of(run(d, profile={"name": "Mona", "language": "en", "mode": "direct"})[1])
            self.assertTrue(ctx.startswith("# 👤"), ctx[:80])
            self.assertIn("Mona", ctx)
            self.assertIn("highest priority", ctx)
            self.assertLess(ctx.index("Mona"), ctx.index("# sabry-kit rules"))

    def test_switched_off_rule_is_not_injected(self):
        with tempfile.TemporaryDirectory() as d:
            ctx = ctx_of(run(d, profile={"settings": {"comment_discipline": False}})[1])
            self.assertNotIn("Comment discipline", ctx.split("# sabry-kit rules", 1)[1])
            self.assertIn("code without comments", ctx)

    def test_deal_economics_only_when_enabled(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertNotIn("# Freelancer-Trap", ctx_of(run(d)[1]))
            self.assertIn("# Freelancer-Trap", ctx_of(run(d, profile={"settings": {"deal_economics": True}})[1]))

    def test_injects_when_no_native_rules(self):
        with tempfile.TemporaryDirectory() as d:
            code, out = run(d)
            self.assertEqual(code, 0)
            self.assertIn("Comment discipline", ctx_of(out))

    def test_injects_when_rules_dir_has_no_markdown(self):
        with tempfile.TemporaryDirectory() as d:
            os.makedirs(os.path.join(d, "rules"))
            self.assertIn("Comment discipline", ctx_of(run(d)[1]))

    def test_profile_that_syncs_late_is_injected_on_first_prompt(self):
        with tempfile.TemporaryDirectory() as d:
            env = {k: v for k, v in os.environ.items() if not k.startswith("SABRY_KIT_")}
            env.update(CLAUDE_CONFIG_DIR=d, HOME=d, USERPROFILE=d)
            start = json.dumps({"session_id": "s-late", "cwd": d})
            p = subprocess.run([sys.executable, HOOK], env=env, input=start, capture_output=True,
                               text=True, encoding="utf-8", timeout=60)
            self.assertIn("first-run setup not done", ctx_of(p.stdout))
            late = lambda: subprocess.run([sys.executable, HOOK, "--late"], env=env, input=start,
                                          capture_output=True, text=True, encoding="utf-8", timeout=60).stdout.strip()
            self.assertEqual(late(), "", "still no profile: nothing to add")
            skill = os.path.join(d, "skills", "synced", "b", "sabry-profile")
            os.makedirs(skill)
            with open(os.path.join(skill, "profile.json"), "w") as fh:
                json.dump({"name": "Synced"}, fh)
            out = json.loads(late())["hookSpecificOutput"]
            self.assertEqual(out["hookEventName"], "UserPromptSubmit")
            self.assertIn("Synced", out["additionalContext"])
            self.assertEqual(late(), "", "injected once")

    def test_path_scoped_rule_is_a_pointer_not_the_body(self):
        rules = os.path.join(os.path.dirname(os.path.dirname(HOOK)), "rules")
        with open(os.path.join(rules, "framework-gotchas.md"), encoding="utf-8") as fh:
            body = fh.read()
        with tempfile.TemporaryDirectory() as d:
            ctx = ctx_of(run(d)[1])
        self.assertIn("framework-gotchas.md", ctx)
        last_line = [l for l in body.strip().splitlines() if l.strip()][-1]
        self.assertNotIn(last_line, ctx)

    def test_force_overrides_skip(self):
        with tempfile.TemporaryDirectory() as d:
            os.makedirs(os.path.join(d, "rules"))
            open(os.path.join(d, "rules", "x.md"), "w").close()
            self.assertIn("Comment discipline", ctx_of(run(d, force=True)[1]))

    def test_injected_context_includes_every_rule_file(self):
        rules = os.path.join(os.path.dirname(os.path.dirname(HOOK)), "rules")
        with tempfile.TemporaryDirectory() as d:
            ctx = ctx_of(run(d)[1])
        for name in sorted(os.listdir(rules)):
            if name.endswith(".md") and name not in RULE_SWITCHES:
                with open(os.path.join(rules, name), encoding="utf-8") as fh:
                    heading = next(l for l in fh if l.startswith("# "))
                self.assertIn(heading.strip(), ctx, name)

    def test_model_is_told_where_the_kit_files_are(self):
        kit = os.path.dirname(os.path.dirname(HOOK)).replace("\\", "/")
        with tempfile.TemporaryDirectory() as d:
            ctx = ctx_of(run(d)[1])
            self.assertIn(f"`{kit}/Roles/<name>.md`", ctx)
            self.assertLess(ctx.index("Kit folder"), ctx.index("# Working mode"))
            sub = lambda agent: run(d, args=("--subagent",), payload=json.dumps(
                {"hook_event_name": "SubagentStart", "agent_type": agent}))[1]
            self.assertIn(f"{kit}/Roles", ctx_of(sub("sabry-kit:cto")))
            self.assertIn("Kit folder", ctx_of(sub("Explore")))
            self.assertEqual(sub("other-plugin:reviewer"), "")
        self.assertTrue(os.path.isfile(os.path.join(kit, "Roles", "CTO.md")))

    def test_rules_are_injected_again_after_compaction(self):
        compact = json.dumps({"hook_event_name": "SessionStart", "source": "compact", "session_id": "s"})
        with tempfile.TemporaryDirectory() as d:
            first = [run(d, args=("--part", str(n)))[1] for n in range(1, 5)]
            again = [run(d, args=("--part", str(n)), payload=compact)[1] for n in range(1, 5)]
        self.assertEqual(first, again)
        self.assertIn("Working mode", "".join(again))
        with open(os.path.join(os.path.dirname(HOOK), "hooks.json"), encoding="utf-8") as fh:
            hooks = json.load(fh)
        for group in hooks["hooks"]["SessionStart"]:
            if any("inject-rules.py" in h["command"] for h in group["hooks"]):
                self.assertNotIn("matcher", group, "a matcher here would skip the compact source")

    def test_parts_stay_under_the_hook_output_cap_and_cover_everything(self):
        with tempfile.TemporaryDirectory() as d:
            whole = ctx_of(run(d)[1])
            parts = []
            for n in range(1, 5):
                out = run(d, args=("--part", str(n)))[1]
                if out:
                    parts.append(ctx_of(out))
            self.assertEqual(run(d, args=("--part", "9"))[1], "")
        self.assertGreaterEqual(len(parts), 1)
        for text in parts:
            self.assertLess(len(text), 10000)
        self.assertTrue(parts[0].startswith("# ⚙️ sabry-kit"))
        if len(parts) > 1:
            self.assertIn("part 2 of", parts[1])
        joined = "\n".join(parts)
        for heading in [l for l in whole.splitlines() if l.startswith("# ")]:
            self.assertIn(heading, joined)
        import json as _json
        with open(os.path.join(os.path.dirname(HOOK), "hooks.json"), encoding="utf-8") as fh:
            hooks = _json.load(fh)
        registered = [h["command"] for g in hooks["hooks"]["SessionStart"] for h in g["hooks"] if "inject-rules.py" in h["command"]]
        self.assertGreaterEqual(len(registered), len(parts), "every part must be registered in hooks.json")

    def test_long_rules_are_split_instead_of_truncated(self):
        spec = importlib.util.spec_from_file_location("inject_rules", HOOK)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        packs = mod.pack(["a" * 4000, "b" * 4000, "c" * 4000, "d" * 100])
        self.assertEqual([len(p) for p in packs], [2, 2])
        for p in packs:
            self.assertLess(len(mod.SEPARATOR.join(p)), 10000)
        big = "\n\n".join("paragraph %d " % i + "x" * 900 for i in range(14))
        packs = mod.pack(["intro", big, "outro"])
        self.assertGreater(len(packs), 1)
        for p in packs:
            self.assertLess(len(mod.SEPARATOR.join(p)), 10000, "an over-long section is split, never truncated")
        joined = "".join(mod.SEPARATOR.join(p) for p in packs)
        for i in range(14):
            self.assertIn("paragraph %d " % i, joined)
        self.assertLess(max(len(mod.SEPARATOR.join(p)) for p in mod.pack(["y" * 30000])), 10000)

    def test_every_reference_the_rules_name_exists(self):
        kit = os.path.dirname(os.path.dirname(HOOK))
        import re
        named = set()
        for name in os.listdir(os.path.join(kit, "rules")):
            with open(os.path.join(kit, "rules", name), encoding="utf-8") as fh:
                named |= set(re.findall(r"`(Reference/[\w-]+\.md)`", fh.read()))
        self.assertGreaterEqual(len(named), 5)
        for rel in named:
            self.assertTrue(os.path.isfile(os.path.join(kit, rel)), rel)


if __name__ == "__main__":
    unittest.main()
