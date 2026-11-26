# -*- coding: utf-8 -*-
"""Tests for enforce-code-traps.py. Every trap is paired with the correct version of the
same code, which must pass: a hook that cries wolf gets switched off."""
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest

HOOK = os.path.join(os.path.dirname(os.path.abspath(__file__)), "enforce-code-traps.py")
SERVICE = "Src/Modules/Orders/Orders.Service.ts"


def run(ti, warn=False, env=None, cwd="."):
    e = dict(os.environ)
    e.pop("SABRY_KIT_CODE_TRAPS", None)
    e.pop("CLAUDE_PROJECT_DIR", None)
    e.update(env or {})
    args = [sys.executable, HOOK] + (["--warn"] if warn else [])
    p = subprocess.run(args, input=json.dumps({"tool_input": ti, "cwd": cwd}),
                       capture_output=True, text=True, encoding="utf-8", env=e)
    out = (p.stdout or "").strip()
    if not out:
        return None
    data = json.loads(out)
    return data.get("decision") or data["hookSpecificOutput"]["permissionDecision"]


def w(content, path=SERVICE):
    return {"file_path": path, "content": content}


DENY = [
    ("update without where",
     "await db.update(Users).set({ IsActive: false })\n",
     "await db.update(Users).set({ IsActive: false }).where(eq(Users.Id, Id))\n"),
    ("delete without where, multiline",
     "return Tx\n  .delete(Sessions)\n",
     "return Tx\n  .delete(Sessions)\n  .where(eq(Sessions.UserId, UserId))\n"),
    ("update with generic set, no where",
     "await db.update(Orders).set<IOrder>({ Status: \"Paid\" }).returning()\n",
     "await db.update(Orders).set<IOrder>({ Status: \"Paid\" }).where(eq(Orders.Id, Id)).returning()\n"),
    ("forEach async",
     "Items.forEach(async (I) => { await Save(I) })\n",
     "for (const I of Items) await Save(I)\n"),
]

WARN = [
    ("N+1 in for loop",
     "for (const O of Orders) {\n  O.Customer = await db.query.Users.findFirst({ where: eq(Users.Id, O.CustomerId) })\n}\n",
     "const Customers = await db.select().from(Users).where(inArray(Users.Id, Ids))\n".replace("select()", "select({ Id: Users.Id })")),
    ("N+1 in map callback",
     "const Rows = Orders.map(async (O) => await UsersRepo.findById(O.CustomerId))\n",
     "const ById = new Map(Customers.map((C) => [C.Id, C]))\n"),
    ("Promise.all over map with db",
     "await Promise.all(Ids.map((Id) => db.select({ Id: Users.Id }).from(Users).where(eq(Users.Id, Id))))\n",
     "await Promise.all([LoadOrders(Id), LoadUser(Id)])\n"),
    ("nested scan",
     "const Out = Orders.map((O) => ({ ...O, Customer: Customers.find((C) => C.Id === O.CustomerId) }))\n",
     "const Out = Orders.map((O) => ({ ...O, Customer: ById.get(O.CustomerId) }))\n"),
    ("fetch without timeout",
     "const Res = await fetch(Url, { method: \"POST\", body })\n",
     "const Res = await fetch(Url, { method: \"POST\", body, signal: AbortSignal.timeout(5000) })\n"),
    ("unbounded zod array",
     "export const S = z.object({ Ids: z.array(z.string().uuid()) })\n",
     "export const S = z.object({ Ids: z.array(z.string().uuid()).min(1).max(500) })\n"),
    ("select star",
     "const Rows = await db.select().from(Orders).limit(50)\n",
     "const Rows = await db.select({ Id: Orders.Id }).from(Orders).limit(50)\n"),
    ("money float",
     "const TotalMinor = parseFloat(Body.Amount) * 100\n",
     "const TotalMinor = ToMinor(Body.Amount, Currency)\n"),
    ("empty catch",
     "try { await Send() } catch (E) {}\n",
     "try { await Send() } catch (E) { Log.warn({ err: E }, \"send failed\") }\n"),
    ("console in server code",
     "console.log(\"order created\", Id)\n",
     "Log.info({ OrderId: Id }, \"order created\")\n"),
    ("hashSync on request path",
     "const Hash = bcrypt.hashSync(Password, 10)\n",
     "const Hash = await Bun.password.hash(Password)\n"),
    ("delete with no where on another client",
     "await pool.delete(Rows)\n",
     "await pool.delete(Rows).where(eq(Rows.Id, Id))\n"),
    ("readFileSync on request path",
     "const Tpl = readFileSync(Path, \"utf8\")\n",
     "const Tpl = await Bun.file(Path).text()\n"),
]


class DenyTier(unittest.TestCase):
    def test_traps_are_denied_and_fixes_pass(self):
        for name, bad, good in DENY:
            with self.subTest(name):
                self.assertEqual(run(w(bad)), "deny", f"{name}: trap not blocked")
                self.assertIsNone(run(w(good)), f"{name}: correct code blocked")

    def test_sync_crypto_is_never_denied(self):
        self.assertIsNone(run(w("const H = bcrypt.hashSync(P, 10)\n")))
        self.assertIsNone(run(w("const H = bcrypt.hashSync(P, 10)\n", "Src/Cli/Seed.Admin.ts"), warn=True))

    def test_legacy_line_in_old_string_not_blocked(self):
        old = "await db.update(Users).set({ A: 1 })\n"
        ti = {"file_path": SERVICE, "old_string": old, "new_string": old + "const X = 1\n"}
        self.assertIsNone(run(ti))

    def test_multiedit(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "Orders.Service.ts")
            with open(path, "w", encoding="utf-8") as fh:
                fh.write("a()\nc()\nconst X = 1\n")
            ti = {"file_path": path, "edits": [
                {"old_string": "a()", "new_string": "b()"},
                {"old_string": "c()", "new_string": "await db.delete(Carts)"}]}
            self.assertEqual(run(ti), "deny")

    def edit(self, before, old, new, name="Orders.Service.ts"):
        d = tempfile.mkdtemp()
        self.addCleanup(lambda: __import__("shutil").rmtree(d, ignore_errors=True))
        path = os.path.join(d, name)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(before)
        return {"file_path": path, "old_string": old, "new_string": new}, d

    def test_where_outside_the_edited_lines_counts(self):
        before = "export async function Off(Id) {\n  await db.update(Users)\n    .set({ A: 1 })\n    .where(eq(Users.Id, Id))\n}\n"
        ti, _ = self.edit(before, "await db.update(Users)", "await db.update(Accounts)")
        self.assertIsNone(run(ti))
        before_bad = "export async function Off() {\n  await db.update(Users)\n    .set({ A: 1 })\n}\n"
        ti, _ = self.edit(before_bad, "  await db.update(Users)\n    .set({ A: 1 })\n", "  await db.update(Accounts)\n    .set({ A: 1 })\n")
        self.assertEqual(run(ti), "deny")

    def test_cut_off_chain_in_an_unreadable_edit_is_allowed(self):
        ti = {"file_path": "/nowhere/Orders.Service.ts", "old_string": "await db.update(Users)",
              "new_string": "await db.update(Accounts)"}
        self.assertIsNone(run(ti))

    def test_dynamic_chain_is_allowed(self):
        self.assertIsNone(run(w("return db.update(T).set(V).$dynamic()\n")))

    def test_other_clients_are_not_denied(self):
        for code in ("await client.delete(Key)\n", "await pool.delete(Rows)\n", "await sql.update(X)\n"):
            with self.subTest(code):
                self.assertIsNone(run(w(code)))

    def test_traps_inside_strings_and_comments_pass(self):
        code = 'const Doc = "never write Items.forEach(async (I) => I)"\nconst T = `await db.delete(Carts)`\n'
        self.assertIsNone(run(w(code)))

    def test_escape_hatch(self):
        code = "// IMPORTANT: allow-where: nightly reset of the scratch table\nawait db.delete(ScratchRows)\n"
        self.assertIsNone(run(w(code)))
        code = "Items.forEach(async (I) => Notify(I)) // IMPORTANT: allow-foreach-async: fire and forget\n"
        self.assertIsNone(run(w(code)))
        self.assertEqual(run(w("// IMPORTANT: allow-where: x\nItems.forEach(async (I) => I)\n")), "deny")

    def test_deny_message_names_the_escape_hatch(self):
        p = subprocess.run([sys.executable, HOOK], input=json.dumps({"tool_input": w("await db.delete(Carts)\n"), "cwd": "."}),
                           capture_output=True, text=True, encoding="utf-8")
        self.assertIn("IMPORTANT: allow-where", p.stdout)


class WarnTier(unittest.TestCase):
    def test_traps_warn_and_fixes_pass(self):
        for name, bad, good in WARN:
            with self.subTest(name):
                self.assertEqual(run(w(bad), warn=True), "block", f"{name}: trap not reported")
                self.assertIsNone(run(w(good), warn=True), f"{name}: correct code reported")

    def test_batched_loops_are_not_n_plus_one(self):
        chunked = ("for (let I = 0; I < Rows.length; I += CHUNK) {\n"
                   "  await db.insert(Products).values(Rows.slice(I, I + CHUNK))\n}\n")
        keyset = ("while (true) {\n  const Batch = await db.select({ Id: Orders.Id }).from(Orders)"
                  ".where(gt(Orders.Id, Last)).limit(1000)\n  if (!Batch.length) break\n}\n")
        raw_sql = ("while (true) {\n  const Rows = await db.execute(sql`UPDATE \"Users\" SET \"A\" = 1 WHERE \"Id\" IN "
                   "(SELECT \"Id\" FROM \"Users\" WHERE \"A\" IS NULL LIMIT 2000) RETURNING \"Id\"`)\n  if (!Rows.length) break\n}\n")
        self.assertIsNone(run(w(raw_sql), warn=True))
        self.assertIsNone(run(w(chunked), warn=True))
        self.assertIsNone(run(w(keyset), warn=True))

    def test_small_literal_lists_are_not_nested_scans(self):
        code = "const Allowed = Roles.filter((R) => [\"Admin\", \"Owner\"].includes(R))\n"
        code += "const Paid = Orders.filter((O) => PAID_STATUSES.includes(O.Status))\n"
        self.assertIsNone(run(w(code), warn=True))

    def test_select_inside_exists_is_fine(self):
        code = "const Q = await db.select({ Id: T.Id }).from(T).where(exists(Tx.select().from(Users).where(eq(Users.Id, T.UserId))))\n"
        self.assertIsNone(run(w(code), warn=True))

    def test_console_allowed_in_client_components(self):
        self.assertIsNone(run(w("console.error(E)\n", "src/components/Form.tsx"), warn=True))


class Scope(unittest.TestCase):
    def test_tests_scripts_and_non_code_are_skipped(self):
        bad = "await db.update(Users).set({ A: 1 })\nItems.forEach(async (I) => I)\n"
        for path in ("Src/Modules/Orders/Test/Orders.test.ts", "scripts/backfill.ts",
                     "Src/Database/Migrations/0003.ts", "notes.md", "data.json"):
            with self.subTest(path):
                self.assertIsNone(run(w(bad, path)))
                self.assertIsNone(run(w(bad, path), warn=True))

    def test_project_location_does_not_make_a_request_path(self):
        root = "/home/u/services/billing"
        ti = w("export const Sha = execSync(\"git rev-parse HEAD\")\n", root + "/src/version.ts")
        self.assertIsNone(run(ti, warn=True, cwd=root))
        self.assertEqual(run(w("const S = execSync(C)\n", root + "/src/services/Deploy.ts"), warn=True, cwd=root), "block")

    def test_generated_tools_and_vendor_are_skipped(self):
        bad = "await db.update(Users).set({ A: 1 })\n"
        for path in ("src/generated/x.ts", "tools/gen.ts", "src/__generated__/a.ts", "src/api.gen.ts",
                     "vendor/lib.js", "src/types.d.ts", "src/__mocks__/db.ts"):
            with self.subTest(path):
                self.assertIsNone(run(w(bad, path)))

    def test_long_lines_are_fast(self):
        code = "const X = [" + ", ".join(f"parseFloat(A{i}.Amount)" for i in range(30000)) + "]\n"
        started = time.monotonic()
        run(w(code), warn=True)
        self.assertLess(time.monotonic() - started, 8)

    def test_switch_off(self):
        bad = "await db.update(Users).set({ A: 1 })\n"
        self.assertIsNone(run(w(bad), env={"SABRY_KIT_CODE_TRAPS": "0"}))

    def test_bad_input_never_breaks(self):
        p = subprocess.run([sys.executable, HOOK], input="not json", capture_output=True, text=True)
        self.assertEqual((p.returncode, p.stdout.strip()), (0, ""))


if __name__ == "__main__":
    unittest.main()
