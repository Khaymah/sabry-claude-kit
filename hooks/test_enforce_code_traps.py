# -*- coding: utf-8 -*-
"""Tests for enforce-code-traps.py. Every trap is paired with the correct version of the
same code, which must pass: a hook that cries wolf gets switched off."""
import json
import os
import subprocess
import sys
import unittest

HOOK = os.path.join(os.path.dirname(os.path.abspath(__file__)), "enforce-code-traps.py")
SERVICE = "Src/Modules/Orders/Orders.Service.ts"


def run(ti, warn=False, env=None):
    e = dict(os.environ)
    e.pop("SABRY_KIT_CODE_TRAPS", None)
    e.update(env or {})
    args = [sys.executable, HOOK] + (["--warn"] if warn else [])
    p = subprocess.run(args, input=json.dumps({"tool_input": ti, "cwd": "."}),
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
    ("hashSync on request path",
     "const Hash = bcrypt.hashSync(Password, 10)\n",
     "const Hash = await Bun.password.hash(Password)\n"),
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

    def test_sync_crypto_allowed_outside_request_path(self):
        self.assertIsNone(run(w("const H = bcrypt.hashSync(P, 10)\n", "Src/Cli/Seed.Admin.ts")))

    def test_legacy_line_in_old_string_not_blocked(self):
        old = "await db.update(Users).set({ A: 1 })\n"
        ti = {"file_path": SERVICE, "old_string": old, "new_string": old + "const X = 1\n"}
        self.assertIsNone(run(ti))

    def test_multiedit(self):
        ti = {"file_path": SERVICE, "edits": [
            {"old_string": "a()", "new_string": "b()"},
            {"old_string": "c()", "new_string": "await db.delete(Carts)"}]}
        self.assertEqual(run(ti), "deny")


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

    def test_switch_off(self):
        bad = "await db.update(Users).set({ A: 1 })\n"
        self.assertIsNone(run(w(bad), env={"SABRY_KIT_CODE_TRAPS": "0"}))

    def test_bad_input_never_breaks(self):
        p = subprocess.run([sys.executable, HOOK], input="not json", capture_output=True, text=True)
        self.assertEqual((p.returncode, p.stdout.strip()), (0, ""))


if __name__ == "__main__":
    unittest.main()
