"""Tests for the native plugin packages: the generated files match the kit's sources, the
manifests point at files that exist, and the OpenCode plugin injects the rules and blocks
what the kit's hooks block, under both of OpenCode's plugin APIs."""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
KIT = os.path.dirname(HERE)
PLUGIN = os.path.join(KIT, "adapters", "opencode", "index.js")
TRAILER = "Co-Authored-By: " + "Claude <noreply@anthropic.com>"

DRIVER = r"""
import plugin, { check, toClaude } from %s
const out = {}
const v1 = await plugin.server()
const sys = { system: [] }
await v1["experimental.chat.system.transform"]({}, sys)
out.v1Rules = sys.system.join("\n")
const attempt = async (fn) => { try { await fn(); return "allowed" } catch (e) { return "blocked: " + e.message.slice(0, 80) } }
out.v1BadCommit = await attempt(() => v1["tool.execute.before"]({ tool: "bash" }, { args: { command: %s } }))
out.v1GoodCommit = await attempt(() => v1["tool.execute.before"]({ tool: "bash" }, { args: { command: "git commit -m \"feat: add login\"" } }))
out.v1Comment = await attempt(() => v1["tool.execute.before"]({ tool: "write" }, { args: { filePath: process.cwd() + "/a.ts", content: "// note\nexport const a = 1\n" } }))
out.v1Clean = await attempt(() => v1["tool.execute.before"]({ tool: "write" }, { args: { filePath: process.cwd() + "/a.ts", content: "export const a = 1\n" } }))
out.v1Read = await attempt(() => v1["tool.execute.before"]({ tool: "read" }, { args: { filePath: "x" } }))
const hooks = {}
const ctx = { session: { hook: async (n, f) => { hooks["session." + n] = f } }, tool: { hook: async (n, f) => { hooks["tool." + n] = f } } }
await plugin.setup(ctx)
const event = { system: [] }
await hooks["session.context"](event)
out.v2Rules = event.system.map((p) => p.text).join("\n")
out.v2Compaction = typeof hooks["session.compaction"]
out.v2Edit = await attempt(() => hooks["tool.execute.before"]({ tool: "edit", input: { filePath: process.cwd() + "/b.ts", oldString: "a", newString: "/* why */ a" } }))
out.v2Patch = await attempt(() => hooks["tool.execute.before"]({ tool: "apply_patch", input: { patchText: "*** Begin Patch\n*** Add File: src/c.ts\n+// note\n+export const c = 1\n*** End Patch" } }))
out.map = toClaude("edit", { filePath: "f.ts", oldString: "x", newString: "y" })
out.id = plugin.id
console.log(JSON.stringify(out))
"""


class AdaptersTest(unittest.TestCase):
    def test_generated_files_match_the_sources(self):
        p = subprocess.run([sys.executable, os.path.join(HERE, "build_adapters.py"), "--check"],
                           capture_output=True, text=True, timeout=120)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)

    def test_manifests_point_at_existing_files(self):
        with open(os.path.join(KIT, "kimi.plugin.json"), encoding="utf-8") as fh:
            kimi = json.load(fh)
        for key in ("skills", "agents", "systemPromptPath"):
            self.assertTrue(os.path.exists(os.path.join(KIT, kimi[key])), key)
        self.assertLessEqual(os.path.getsize(os.path.join(KIT, kimi["systemPromptPath"])), 32 * 1024)
        for hook in kimi["hooks"]:
            self.assertLessEqual(set(hook), {"event", "matcher", "command", "timeout"})
            self.assertIn("./hooks/adapt.py kimi", hook["command"])
        agents = os.listdir(os.path.join(KIT, kimi["agents"]))
        self.assertEqual(len(agents), len([f for f in os.listdir(os.path.join(KIT, "agents")) if f.endswith(".md")]))
        with open(os.path.join(KIT, ".codex-plugin", "plugin.json"), encoding="utf-8") as fh:
            codex = json.load(fh)
        self.assertTrue(os.path.isfile(os.path.join(KIT, codex["hooks"])), "Codex must not fall back to the Claude hooks")
        with open(os.path.join(KIT, codex["hooks"]), encoding="utf-8") as fh:
            commands = [h["command"] for groups in json.load(fh)["hooks"].values() for g in groups for h in g["hooks"]]
        self.assertTrue(all('${PLUGIN_ROOT}/hooks/adapt.py" codex ' in c for c in commands))
        self.assertTrue(any("inject-rules.py --part 1" in c for c in commands))
        with open(os.path.join(KIT, ".agents", "plugins", "marketplace.json"), encoding="utf-8") as fh:
            market = json.load(fh)
        self.assertEqual(market["plugins"][0]["name"], codex["name"])
        tracked = subprocess.run(["git", "-C", KIT, "check-ignore", ".agents/plugins/marketplace.json"],
                                 capture_output=True, text=True).returncode
        self.assertEqual(tracked, 1, "the marketplace file must not be git-ignored")

    def test_opencode_plugin_injects_rules_and_blocks_like_the_hooks(self):
        if not shutil.which("node"):
            self.skipTest("no node")
        with tempfile.TemporaryDirectory() as tmp:
            home = os.path.join(tmp, "home")
            os.makedirs(home)
            work = os.path.join(tmp, "work")
            os.makedirs(work)
            subprocess.run(["git", "init", "-q", work], capture_output=True)
            driver = os.path.join(tmp, "driver.mjs")
            with open(driver, "w", encoding="utf-8") as fh:
                fh.write(DRIVER % (json.dumps("file://" + PLUGIN), json.dumps('git commit -m "feat: x\n\n' + TRAILER + '"')))
            env = {k: v for k, v in os.environ.items() if not k.startswith("SABRY_KIT_") and k != "CLAUDE_CONFIG_DIR"}
            env.update(HOME=home, USERPROFILE=home)
            p = subprocess.run(["node", driver], capture_output=True, text=True, cwd=work, env=env, timeout=240)
            self.assertEqual(p.returncode, 0, p.stderr)
            out = json.loads(p.stdout.strip().splitlines()[-1])
        self.assertEqual(out["id"], "sabry-kit")
        for key in ("v1Rules", "v2Rules"):
            self.assertIn("Comment discipline", out[key])
            self.assertIn("kit-setup", out[key])
        self.assertTrue(out["v1BadCommit"].startswith("blocked"), out["v1BadCommit"])
        self.assertEqual(out["v1GoodCommit"], "allowed")
        self.assertTrue(out["v1Comment"].startswith("blocked"))
        self.assertEqual(out["v1Clean"], "allowed")
        self.assertEqual(out["v1Read"], "allowed")
        self.assertTrue(out["v2Edit"].startswith("blocked"))
        self.assertTrue(out["v2Patch"].startswith("blocked"))
        self.assertEqual(out["v2Compaction"], "function")
        self.assertEqual(out["map"], {"tool_name": "Edit", "tool_input": {"file_path": "f.ts", "old_string": "x", "new_string": "y"}})


if __name__ == "__main__":
    unittest.main()
