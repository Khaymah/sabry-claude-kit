"""Tests for skills/quote/render.py: the numbers are computed, an incomplete offer is refused,
the layout is fixed, identities stay private, and the PDF comes out when a browser exists."""
import copy
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

KIT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKILL = os.path.join(KIT, "skills", "quote")
SCRIPT = os.path.join(SKILL, "render.py")
with open(os.path.join(SKILL, "assets", "sample-offer.json"), encoding="utf-8") as fh:
    SAMPLE = json.load(fh)
DEMO = {"name": "Demo Studio", "tagline": "برمجيات", "signer": "Sara Demo", "phone": "+20 100 000 0000",
        "email": "hello@demo.example", "ref_prefix": "DEMO"}
HEADINGS = ["الموضوع:", "أولاً: العرض الفني", "1. فهمنا للمطلوب", "3. البنية التقنية",
            "4. خطة التنفيذ والجدول الزمني", "5. التدريب والتوثيق والضمان والدعم", "ثانياً: العرض المالي",
            "الإجمالي العام", "بنود إضافية", "شروط الدفع", "ما يشمله العرض", "ما لا يشمله العرض",
            "بنود تحتاج إلى توضيح قبل بدء العمل", "أحكام عامة"]


def module():
    spec = importlib.util.spec_from_file_location("quote_render", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class QuoteTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = os.path.join(self.tmp.name, "home")
        os.makedirs(os.path.join(self.home, ".agents", "quote"))
        with open(os.path.join(self.home, ".agents", "quote", "identities.json"), "w", encoding="utf-8") as fh:
            json.dump({"demo": DEMO}, fh)
        self.env = {k: v for k, v in os.environ.items() if k not in ("CLAUDE_CONFIG_DIR",)}
        self.env.update(HOME=self.home, USERPROFILE=self.home)
        self.mod = module()

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, offer, name="offer.json"):
        path = os.path.join(self.tmp.name, name)
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(offer, fh, ensure_ascii=False)
        return path

    def run_cli(self, *args):
        return subprocess.run([sys.executable, SCRIPT] + list(args), capture_output=True, text=True,
                              env=self.env, timeout=240)

    def compute(self, offer):
        return self.mod.compute(offer, {"demo": DEMO})

    def test_numbers_are_computed_not_trusted(self):
        c = self.compute(SAMPLE)
        self.assertEqual(c["totals"], [75000, 51500])
        self.assertEqual(c["grand"], 126500)
        self.assertEqual(c["discounted"], 120000, "5% off 126,500 is 120,175, rounded down to the 1,000")
        self.assertEqual(c["valid_until"].isoformat(), "2026-11-30")

    def test_incomplete_offer_is_refused_with_every_problem(self):
        bad = copy.deepcopy(SAMPLE)
        bad["identity"] = "nobody"
        bad["systems"][0]["items"][0]["price"] = 400.5
        bad["financial"]["payments"][0]["percent"] = 30
        bad["technical"]["basis"] = "rfp"
        bad["duration"] = "[[confirm duration with the owner]]"
        del bad["recipient"]["org"]
        with self.assertRaises(self.mod.OfferError) as ctx:
            self.compute(bad)
        text = str(ctx.exception)
        for fragment in ("identity `nobody`", "positive whole number", "add up to 90", "technical.compliance",
                         "unresolved gap", "recipient.org"):
            self.assertIn(fragment, text)
        result = self.run_cli(self.write(bad))
        self.assertEqual(result.returncode, 2)
        self.assertIn("not rendered", result.stderr)
        self.assertFalse(os.path.exists(os.path.join(self.tmp.name, "DEMO-SHOP-2026-01.pdf")))

    def test_layout_is_fixed_and_in_order(self):
        html = self.mod.build_html(SAMPLE, self.compute(SAMPLE))
        positions = [html.find(h) for h in HEADINGS]
        self.assertTrue(all(p >= 0 for p in positions), [h for h, p in zip(HEADINGS, positions) if p < 0])
        self.assertEqual(positions, sorted(positions))
        self.assertIn("2. نطاق العمل", html)
        self.assertNotIn("مصفوفة الالتزام", html)
        self.assertIn("126,500 جنيه", html)
        self.assertIn("120,000", html)
        self.assertIn("15 يوماً من تاريخه (حتى 30 نوفمبر 2026)", html)
        self.assertIn("الأولى", html)
        self.assertIn("الأسعار بالجنيه المصري.", html)
        self.assertEqual(html.count("Sara Demo"), 2, "signature on the cover and on the last page")

    def test_rfp_basis_renders_the_compliance_matrix(self):
        offer = copy.deepcopy(SAMPLE)
        offer["technical"]["basis"] = "rfp"
        offer["technical"]["compliance"] = [{"title": "المتجر", "items": [{"id": "2.1", "name": "الواجهة", "how": "…"}]}]
        html = self.mod.build_html(offer, self.compute(offer))
        self.assertIn("2. مصفوفة الالتزام بالمواصفات", html)
        self.assertIn("ملتزم", html)
        self.assertNotIn("2. نطاق العمل", html)

    def test_content_cannot_inject_markup(self):
        offer = copy.deepcopy(SAMPLE)
        offer["subject"] = "<script>alert(1)</script> **مهم**"
        html = self.mod.build_html(offer, self.compute(offer))
        self.assertNotIn("<script>", html)
        self.assertIn("&lt;script&gt;", html)
        self.assertIn("<strong>مهم</strong>", html)

    def test_single_system_without_discount(self):
        offer = copy.deepcopy(SAMPLE)
        offer["systems"] = offer["systems"][:1]
        offer.pop("bundle_discount")
        c = self.compute(offer)
        self.assertIsNone(c["discounted"])
        html = self.mod.build_html(offer, c)
        self.assertNotIn("إجمالي النظامين", html)
        self.assertNotIn("خصم", html)

    def test_identities_are_private_and_synced_copies_are_read(self):
        synced = os.path.join(self.home, ".claude", "skills", "synced", "x", "sabry-profile", "quote")
        os.makedirs(synced)
        with open(os.path.join(synced, "identities.json"), "w", encoding="utf-8") as fh:
            json.dump({"other": {"name": "Other Co", "signer": "X"}}, fh)
        listed = json.loads(self.run_cli("identities").stdout)
        self.assertEqual(sorted(listed), ["demo", "other"])
        bad = self.run_cli("add-identity", '{"key":"Bad Key","name":"x"}')
        self.assertEqual(bad.returncode, 2)
        ok = self.run_cli("add-identity", '{"key":"me","name":"Me","signer":"Me"}')
        self.assertEqual(ok.returncode, 0, ok.stderr)
        self.assertTrue(ok.stdout.strip().startswith(os.path.join(self.home, ".agents", "quote")))
        self.assertFalse(any(name.endswith("identities.json") for name in os.listdir(SKILL)),
                         "no identity is ever stored in the kit")

    def test_pdf_is_produced_when_a_browser_exists(self):
        if not self.mod.find_chrome() or not shutil.which("pdfinfo"):
            self.skipTest("no browser or pdfinfo here")
        out = os.path.join(self.tmp.name, "out")
        result = self.run_cli(self.write(SAMPLE), "--out", out)
        self.assertEqual(result.returncode, 0, result.stderr)
        pdf = os.path.join(out, "DEMO-SHOP-2026-01.pdf")
        info = subprocess.run(["pdfinfo", pdf], capture_output=True, text=True, timeout=30).stdout
        self.assertIn("A4", info)
        pages = int(next(l.split()[-1] for l in info.splitlines() if l.startswith("Pages:")))
        self.assertGreaterEqual(pages, 3)
        text = subprocess.run(["pdftotext", "-f", "1", "-l", "1", pdf, "-"], capture_output=True, text=True,
                              timeout=30).stdout
        self.assertIn("DEMO-SHOP-2026-01", text)
        self.assertIn(f"1 / {pages}", text, "footer with page numbers")


if __name__ == "__main__":
    unittest.main()
