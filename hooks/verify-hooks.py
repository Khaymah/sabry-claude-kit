#!/usr/bin/env python3
"""
verify-hooks — يتحقق أن الـ hooks تعمل **سلوكياً**، لا أنها مكتوبة في ملف.

الفرق جوهري: Serena كانت مسجّلة بشكل سليم تماماً في .claude.json ولم تعمل يوماً.
وجود السطر في الإعداد ليس دليلاً. هذا السكربت يشغّل كل hook فعلياً بمُدخل حقيقي
ويقارن المخرَج بالمتوقَّع.

    python verify-hooks.py

يخرج بـ 0 إن نجح الكل، و1 إن فشل أي شيء.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile

HOOKS = os.path.dirname(os.path.abspath(__file__))
CLAUDE = os.path.dirname(HOOKS)

PASS, FAIL = [], []


def check(name, ok, detail="", info=""):
    """`detail` يُعرض عند الفشل فقط — وإلا ظهر نص التشخيص كأنه وصف لنجاح.
    `info` يُعرض دائماً (مسار، رقم قياس)."""
    (PASS if ok else FAIL).append(name)
    extra = info if ok else (detail or info)
    print(f"  {'✅' if ok else '❌'} {name}" + (f"  — {extra}" if extra else ""))


def run_hook(script, payload, cwd=None, env=None, args=()):
    """يشغّل hook بمُدخل stdin ويعيد (stdout, exit_code)."""
    e = None
    if env:
        e = dict(os.environ)
        e.update(env)
    p = subprocess.run(
        [sys.executable, os.path.join(HOOKS, script)] + list(args),
        input=json.dumps(payload), capture_output=True, text=True,
        cwd=cwd, env=e, timeout=60,
    )
    return p.stdout.strip(), p.returncode


# ─────────────────────────────────────────────────────────── enforce-opus
def test_enforce_opus():
    print("\n🔒 enforce-opus  (PreToolUse · matcher Agent|Task)")
    if not os.path.isfile(os.path.join(HOOKS, "enforce-opus.py")):
        return check("الملف موجود", False, "مفقود")

    cases = [
        ("model غير محدد → opus", {"tool_name": "Agent", "tool_input": {"prompt": "x"}}, True),
        ("model=opus → opus",      {"tool_name": "Agent", "tool_input": {"model": "opus"}}, True),
        ("model=haiku → opus",     {"tool_name": "Task",  "tool_input": {"model": "haiku"}}, True),
        ("model=opus → صامت",      {"tool_name": "Agent", "tool_input": {"model": "opus"}}, False),
        ("payload تالف → لا ينكسر",  "BROKEN", False),
    ]
    for label, payload, should_patch in cases:
        if payload == "BROKEN":
            p = subprocess.run([sys.executable, os.path.join(HOOKS, "enforce-opus.py")],
                               input="not json", capture_output=True, text=True, timeout=30)
            out, rc = p.stdout.strip(), p.returncode
        else:
            out, rc = run_hook("enforce-opus.py", payload)

        if rc != 0:
            check(label, False, f"exit={rc}")
            continue
        if not should_patch:
            check(label, out == "", "أخرج شيئاً وكان يجب أن يصمت" if out else "")
            continue
        try:
            got = json.loads(out)["hookSpecificOutput"]["updatedInput"]["model"]
        except Exception:
            check(label, False, f"مخرَج غير متوقَّع: {out[:60]}")
            continue
        check(label, got == "opus", f"أعاد {got!r}")


# ──────────────────────────────────────────────────── team-review-reminder
def test_team_reminder():
    print("\n👥 team-review-reminder  (Stop)")
    script = os.path.join(HOOKS, "team-review-reminder.py")
    if not os.path.isfile(script):
        return check("الملف موجود", False, "مفقود")

    tmp = tempfile.mkdtemp(prefix="hookverify-")
    try:
        g = lambda *a: subprocess.run(["git"] + list(a), cwd=tmp,
                                      capture_output=True, text=True, timeout=30)
        g("init", "-q", ".")
        g("config", "user.email", "t@t.t")
        g("config", "user.name", "t")

        os.makedirs(os.path.join(tmp, "src", "auth"))
        write = lambda rel, txt: open(os.path.join(tmp, rel), "w", encoding="utf-8").write(txt)
        write("README.md", "# base\n")
        write("src/Aaa.ts", "export const a=1\n")
        write("src/legacy.ts", "export const l=1\n")
        g("add", "-A"); g("commit", "-qm", "base")

        # ── دَنَس سابق للجلسة: ملف كان معدَّلاً قبل أن يفتح Sabry المشروع
        write("src/legacy.ts", "export const l=2 // edited last week\n")
        run_hook("team-review-reminder.py", {}, cwd=tmp, args=["--baseline"])

        out, rc = run_hook("team-review-reminder.py", {}, cwd=tmp)
        check("دَنَس سابق للجلسة → صامت", rc == 0 and out == "",
              "أبلغ عن ملفات لم تلمسها الجلسة" if out else "")

        # وثائق فقط → يجب أن يصمت (لا شيء للفريق ليراجعه)
        write("README.md", "# changed\n")
        out, rc = run_hook("team-review-reminder.py", {}, cwd=tmp)
        check("تغيير وثائق فقط → صامت", rc == 0 and out == "", out[:60])

        # ── عمل الجلسة: تعديل ملف متتبَّع + ملفان جديدان غير متتبَّعين في مجلد جديد
        write("src/Aaa.ts", "export const a=2\n")     # أول سطر في مخرَج git status
        write("src/auth/login.ts", "export function login(){}\n")
        write("src/Button.tsx", "export const B=()=>null\n")
        out, rc = run_hook("team-review-reminder.py", {}, cwd=tmp)
        try:
            ctx = json.loads(out)["hookSpecificOutput"]["additionalContext"]
        except Exception:
            ctx = ""
        check("عمل الجلسة → ينطلق", bool(ctx), out[:80] or "لا مخرَج")
        if ctx:
            # `sh()` كان يستدعي .strip() فيبتلع مسافة عمود الحالة في **السطر الأول** وحده،
            # فيفقد أول حرف من أول مسار: src/Aaa.ts ← rc/Aaa.ts. يمرّ في أي اختبار عابر.
            check("مسار السطر الأول سليم (لا يفقد حرفاً)", "src/Aaa.ts" in ctx,
                  f"ظهر: {ctx[ctx.find('reviewed:'):][:40]}")
            check("رصد login.ts (مجلد جديد لم يُطوَ)", "login.ts" in ctx)
            check("استبعد الدَنَس السابق (legacy.ts)", "legacy.ts" not in ctx,
                  "أدرج ملفاً لم تلمسه الجلسة")
            check("اختار security-reviewer (مسار auth)", "security-reviewer" in ctx)
            check("اختار ux-reviewer (ملف .tsx)", "ux-reviewer" in ctx)
            check("اختار qa-tester (لا اختبارات مسّت)", "qa-tester" in ctx)

        # نفس التغيير مرة أخرى → يجب ألا يُلحّ
        out2, _ = run_hook("team-review-reminder.py", {}, cwd=tmp)
        check("نفس التغيير → لا يتكرّر", out2 == "", out2[:60])

        # تغيير إضافي → مجموعة جديدة، ينطلق ثانيةً
        write("src/auth/token.ts", "export const t=1\n")
        out3, _ = run_hook("team-review-reminder.py", {}, cwd=tmp)
        check("تغيير جديد → ينطلق ثانيةً", out3 != "")

        # حماية الحلقة — إلزامية في عقد الـ hooks
        out4, rc4 = run_hook("team-review-reminder.py", {"stop_hook_active": True}, cwd=tmp)
        check("stop_hook_active → صامت (حماية الحلقة)", rc4 == 0 and out4 == "")

        # خارج مستودع git → صامت
        out5, rc5 = run_hook("team-review-reminder.py", {}, cwd=tempfile.gettempdir())
        check("خارج مستودع git → صامت", rc5 == 0 and out5 == "")

        # مُسجَّل عالمياً ⇒ يعمل في كل مستودع. يجب ألّا يترك أثراً داخل أي منها.
        clean = not os.path.exists(os.path.join(tmp, ".claude"))
        check("لا يُنشئ .claude داخل المستودع", clean,
              "" if clean else "أنشأ مجلداً غير متتبَّع في مشروع ليس ملكه")

        # مستودع إعدادات Claude نفسه → صامت (وإلا تحوّل تعديل أي hook إلى ضجيج دائم)
        out6, rc6 = run_hook("team-review-reminder.py", {},
                             cwd=tmp, env={"CLAUDE_CONFIG_DIR": tmp})
        check("مستودع إعدادات Claude → صامت", rc6 == 0 and out6 == "", out6[:60])
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


# ───────────────────────────────────────────────────────────── التسجيل
def _hooks_of(path):
    """يعيد hooks الملف كنص — أو None إن تعذّر تحليله.

    إعادة "" عند الفشل تجعل ملفاً تالفاً يبدو كملف بلا hooks: الفحص يمرّ أخضر
    بينما الإعداد مكسور فعلاً. الفرق بين "لا يوجد" و"لم أستطع القراءة" جوهري هنا.
    """
    try:
        with open(path, encoding="utf-8") as fh:
            return json.dumps(json.load(fh).get("hooks", {}))
    except Exception:
        return None


def test_registration():
    print("\n📋 التسجيل في الإعدادات")
    g = os.path.join(CLAUDE, "settings.json")
    blob = _hooks_of(g)
    if blob is None:
        return check("settings.json يُحلَّل", False, "JSON تالف — Claude Code لن يقرأه")
    check("settings.json يُحلَّل", True)
    check("enforce-opus مسجَّل عالمياً", "enforce-opus" in blob)
    check("code-review-graph update مسجَّل (PostToolUse)", "code-review-graph update" in blob)
    check("team-review-reminder مسجَّل عالمياً (Stop)", "team-review-reminder" in blob)
    check("لقطة الأساس مسجَّلة (SessionStart --baseline)", "--baseline" in blob,
          "بدونها لا يمكن تمييز عمل الجلسة عن الدَنَس السابق")

    # نسخة محلية + عالمية = الـ hook يعمل مرّتين. الحماية من التكرار تقرأ ملف الحالة،
    # فإن شُغّلا بالتوازي قد يقرآن قبل أن يكتب أيّهما → تذكيران لنفس التغيير.
    print("\n  ازدواج محلي (يجب ألّا يظهر شيء):")
    dupes = []
    roots = [r for r in sys.argv[1:] if os.path.isdir(r)]
    if not roots and os.path.isdir(r"D:\Work"):
        for dirpath, dirnames, _ in os.walk(r"D:\Work"):
            if dirpath.count(os.sep) > 6:
                dirnames[:] = []
                continue
            dirnames[:] = [d for d in dirnames if d not in
                           {"node_modules", ".git", "dist", "build", ".next"}]
            if ".claude" in dirnames:
                roots.append(dirpath)
    seen, broken = set(), []
    for root in roots:
        for fn in ("settings.json", "settings.local.json"):
            p = os.path.join(root, ".claude", fn)
            if p in seen or not os.path.isfile(p):
                continue
            seen.add(p)
            b = _hooks_of(p)
            if b is None:
                broken.append(p)
            elif "team-review-reminder" in b:
                dupes.append(p)
    check(f"لا نسخة محلية مكرّرة ({len(seen)} ملف مفحوص)", not dupes, "؛ ".join(dupes))
    check("كل ملفات الإعداد تُحلَّل", not broken, "؛ ".join(broken))


def test_graph_cli():
    print("\n🕸  code-review-graph CLI")
    exe = shutil.which("code-review-graph")
    check("موجود على PATH", bool(exe),
          "غير موجود — الـ PostToolUse hook لن يفعل شيئاً", info=exe or "")


def test_latency():
    """الـ Stop hook متزامن — لا يمكن أن يكون async لأن additionalContext يحتاج stdout
    مقروءاً. أي أنه يقع على المسار الحرج في نهاية كل دور، في كل مستودع."""
    print("\n⏱  زمن الـ Stop hook (متزامن — على المسار الحرج)")
    import time
    big = [p for p in (
        r"D:\Work\1-Nodejs\CRM\Est8Core\New\Server",
        r"D:\Work\1-Nodejs\CRM\Est8Core\New\est8core-frontend",
        r"D:\Work\1-Nodejs\_RealEstate Ai\Server",
    ) if os.path.isdir(p)]
    if not big:
        return print("  ⏭  لا مستودع كبير متاح للقياس")
    for path in big:
        run_hook("team-review-reminder.py", {}, cwd=path)   # تسخين ذاكرة القرص
        runs = []
        for _ in range(3):
            t = time.perf_counter()
            run_hook("team-review-reminder.py", {}, cwd=path)
            runs.append((time.perf_counter() - t) * 1000)
        ms = min(runs)
        # يشمل زمن إقلاع مفسّر Python (~60–90ms) — Claude Code يدفعه أيضاً.
        label = os.path.relpath(path, r"D:\Work\1-Nodejs").replace("\\", "/")
        check(f"{label}", ms < 500,
              f"{ms:.0f}ms — بطيء على المسار الحرج",
              info=f"{ms:.0f}ms (أدنى 3، دافئ)")


def main():
    print("=" * 74)
    print("  تحقّق سلوكي من الـ hooks — تشغيل فعلي بمُدخلات حقيقية، لا قراءة ملفات")
    print("=" * 74)
    test_enforce_opus()
    test_team_reminder()
    test_registration()
    test_graph_cli()
    test_latency()

    print("\n" + "=" * 74)
    print(f"  ✅ نجح {len(PASS)}   ❌ فشل {len(FAIL)}")
    if FAIL:
        for f in FAIL:
            print(f"     · {f}")
        print("\n  ⚠️ هذا يثبت أن **السكربتات** سليمة أو لا.")
    print("""
  ما لا يستطيع هذا السكربت إثباته: أن Claude Code نفسه يستدعيها.
  لذلك افتح جلسة تفاعلية واكتب:  /hooks
  ثم عدّل أي ملف .ts واتركني أنهي الدور — يجب أن ترى سطر [team-review].""")
    print("=" * 74)
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
