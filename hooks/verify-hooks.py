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
import re
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

        # ── دَنَس سابق للجلسة: ملف كان معدَّلاً قبل أن يفتح المالك المشروع
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
    print("\n📋 التسجيل في hooks/hooks.json (مصدر الـ hooks الوحيد)")
    g = os.path.join(HOOKS, "hooks.json")
    blob = _hooks_of(g)
    if blob is None:
        return check("hooks.json يُحلَّل", False, "JSON تالف — Claude Code لن يقرأه")
    check("hooks.json يُحلَّل", True)
    check("enforce-commit-style مسجَّل (PreToolUse)", "enforce-commit-style" in blob)
    check("enforce-comment-discipline مسجَّل (PreToolUse)", "enforce-comment-discipline" in blob)
    check("code-review-graph update مسجَّل (PostToolUse)", "code-review-graph update" in blob)
    check("team-review-reminder مسجَّل (Stop)", "team-review-reminder" in blob)
    check("لقطة الأساس مسجَّلة (SessionStart --baseline)", "--baseline" in blob,
          "بدونها لا يمكن تمييز عمل الجلسة عن الدَنَس السابق")
    check("enforce-nextjs-structure مسجَّل (PreToolUse)", "enforce-nextjs-structure" in blob)
    check("warn-duplication مسجَّل (PostToolUse)", "warn-duplication" in blob)
    check("project-storage مسجَّل (SessionStart + SessionEnd)",
          "project-storage.py" in blob and "--save-transcript" in blob)
    check("scan-secrets مسجَّل (PreToolUse · Bash)", "scan-secrets.py" in blob)
    check("usage record مسجَّل (SessionEnd)", "usage.py" in blob and " record" in blob)
    check("project-brief مسجَّل (SessionStart)", "project-brief.py" in blob)
    check("read-budget مسجَّل (PreToolUse · Read)", "read-budget.py" in blob)
    check("verify-reminder مسجَّل (Stop)", "verify-reminder.py" in blob)
    check("doctor brief مسجَّل (SessionStart)", "doctor.py" in blob and " brief" in blob)
    check("لا hook يفرض موديل على الـ subagents", "enforce-opus" not in blob
          and "enforce-sonnet" not in blob, "الموديل يأتي من frontmatter كل agent")

    refs = sorted(set(re.findall(r"\$\{CLAUDE_PLUGIN_ROOT\}/([\w./-]+)", blob)))
    missing = [r for r in refs if not os.path.isfile(os.path.join(CLAUDE, r))]
    check(f"كل سكربت مُشار إليه موجود ({len(refs)})", not missing, "؛ ".join(missing))

    hardcoded = []
    for fn in ("hooks/hooks.json", "settings.json"):
        try:
            text = open(os.path.join(CLAUDE, fn), encoding="utf-8").read()
        except OSError:
            continue
        if re.search(r"[A-Za-z]:\\\\|/Users/|/home/|powershell", text, re.I):
            hardcoded.append(fn)
    check("لا مسارات خاصة بجهاز ولا powershell", not hardcoded, "؛ ".join(hardcoded))

    settings = _hooks_of(os.path.join(CLAUDE, "settings.json"))
    check("settings.json بلا hooks (لا تشغيل مزدوج مع الـ plugin)",
          settings in (None, "{}"), "انقلها لـ hooks/hooks.json")

    # نسخة محلية + عالمية = الـ hook يعمل مرّتين. الحماية من التكرار تقرأ ملف الحالة،
    # فإن شُغّلا بالتوازي قد يقرآن قبل أن يكتب أيّهما → تذكيران لنفس التغيير.
    print("\n  ازدواج محلي (يجب ألّا يظهر شيء):")
    dupes = []
    roots = [r for r in sys.argv[1:] if os.path.isdir(r)]
    work = os.environ.get("SABRY_KIT_WORK_ROOT", "")
    if not roots and work and os.path.isdir(work):
        for dirpath, dirnames, _ in os.walk(work):
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


def test_sounds():
    print("\n🔔 الصوت (sounds/play.py)")
    script = os.path.join(CLAUDE, "sounds", "play.py")
    if not os.path.isfile(script):
        return check("الملف موجود", False, "مفقود")
    wavs = ("notification.wav", "question.wav", "done.wav", "error.wav", "needs-input.wav")
    missing = [w for w in wavs if not os.path.isfile(os.path.join(CLAUDE, "sounds", w))]
    check("ملفات الصوت موجودة", not missing, "؛ ".join(missing))
    for label, args, env in (
        ("SABRY_KIT_SOUNDS=0 → صامت", ["done.wav"], {"SABRY_KIT_SOUNDS": "0"}),
        ("ملف غير موجود → صامت", ["nope.wav"], {}),
        ("بلا وسيط → صامت", [], {}),
    ):
        e = dict(os.environ); e.update(env)
        p = subprocess.run([sys.executable, script] + args, capture_output=True,
                           text=True, env=e, timeout=30)
        check(label, p.returncode == 0 and not p.stdout and not p.stderr,
              f"exit={p.returncode} {p.stderr[:80]}")


def test_adapter():
    print("\n🔌 adapt.py  (Codex · Gemini CLI · Cursor)")
    trailer = "Co-Authored-By: " + "Claude <noreply@anthropic.com>"
    bad = 'git commit -m "feat: x\n\n%s"' % trailer
    cases = (
        ("cursor: commit بتوقيع AI → deny", "cursor", "enforce-commit-style.py",
         {"hook_event_name": "beforeShellExecution", "command": bad, "cwd": HOOKS},
         lambda o: o.get("permission") == "deny"),
        ("cursor: أمر عادي → allow صريح", "cursor", "enforce-commit-style.py",
         {"hook_event_name": "beforeShellExecution", "command": "ls", "cwd": HOOKS},
         lambda o: o == {"permission": "allow"}),
        ("cursor: سكربت مفقود → allow (fail-open)", "cursor", "nope.py",
         {"hook_event_name": "beforeShellExecution", "command": "ls"},
         lambda o: o == {"permission": "allow"}),
        ("gemini: run_shell_command بتوقيع AI → deny", "gemini", "enforce-commit-style.py",
         {"hook_event_name": "BeforeTool", "tool_name": "run_shell_command",
          "tool_input": {"command": bad}, "cwd": HOOKS},
         lambda o: o.get("decision") == "deny"),
        ("gemini: write_file بكومنت → deny", "gemini", "enforce-comment-discipline.py",
         {"hook_event_name": "BeforeTool", "tool_name": "write_file",
          "tool_input": {"file_path": "a.ts", "content": "// x\nconst a = 1\n"}},
         lambda o: o.get("decision") == "deny"),
        ("codex: نفس شكل Claude (pass-through)", "codex", "enforce-commit-style.py",
         {"hook_event_name": "PreToolUse", "tool_name": "Bash", "tool_input": {"command": bad}},
         lambda o: o.get("hookSpecificOutput", {}).get("permissionDecision") == "deny"),
    )
    for label, agent, script, payload, ok in cases:
        out, rc = run_hook("adapt.py", payload, args=(agent, script))
        try:
            got = json.loads(out) if out else {}
        except Exception:
            got = {}
        check(label, rc == 0 and ok(got), f"exit={rc} out={out[:70]}")


def test_frontmatter():
    """An unquoted `: ` inside a description is invalid YAML; Claude Code may then skip the
    agent or skill entirely. The kit's tests cannot see that, so check it here."""
    print("\n🧾 frontmatter الـ agents والـ skills")
    import glob
    bad = []
    files = sorted(glob.glob(os.path.join(CLAUDE, "agents", "*.md")) +
                   glob.glob(os.path.join(CLAUDE, "skills", "*", "SKILL.md")))
    for f in files:
        text = open(f, encoding="utf-8").read()
        if not text.startswith("---\n"):
            bad.append(os.path.relpath(f, CLAUDE) + " (no frontmatter)")
            continue
        head = text[4:].split("\n---", 1)[0]
        keys = {}
        for line in head.splitlines():
            m = re.match(r"^([A-Za-z_-]+):\s*(.*)$", line)
            if m:
                keys[m.group(1)] = m.group(2)
        desc = keys.get("description", "")
        if not keys.get("name") or not desc:
            bad.append(os.path.relpath(f, CLAUDE) + " (name/description)")
        elif desc[:1] not in "\"'" and ": " in desc:
            bad.append(os.path.relpath(f, CLAUDE) + " (unquoted ': ' in description)")
    check(f"{len(files)} ملف frontmatter صالح", not bad, "؛ ".join(bad))


def test_graph_cli():
    print("\n🕸  code-review-graph CLI")
    exe = shutil.which("code-review-graph")
    if not exe:
        return print("  ⏭  غير مثبّت (اختياري) — run-if-installed.py يتخطّاه بصمت")
    check("موجود على PATH", True, info=exe)


def test_latency():
    """الـ Stop hook متزامن — لا يمكن أن يكون async لأن additionalContext يحتاج stdout
    مقروءاً. أي أنه يقع على المسار الحرج في نهاية كل دور، في كل مستودع."""
    print("\n⏱  زمن الـ Stop hook (متزامن — على المسار الحرج)")
    import time
    big = [p for p in os.environ.get("SABRY_KIT_BIG_REPOS", "").split(os.pathsep) if p and os.path.isdir(p)]
    if not big:
        return print("  ⏭  لا مستودع كبير متاح للقياس (حدّد SABRY_KIT_BIG_REPOS)")
    for path in big:
        run_hook("team-review-reminder.py", {}, cwd=path)   # تسخين ذاكرة القرص
        runs = []
        for _ in range(3):
            t = time.perf_counter()
            run_hook("team-review-reminder.py", {}, cwd=path)
            runs.append((time.perf_counter() - t) * 1000)
        ms = min(runs)
        # يشمل زمن إقلاع مفسّر Python (~60–90ms) — Claude Code يدفعه أيضاً.
        label = os.path.basename(os.path.normpath(path))
        check(f"{label}", ms < 500,
              f"{ms:.0f}ms — بطيء على المسار الحرج",
              info=f"{ms:.0f}ms (أدنى 3، دافئ)")


def test_suite(title, script):
    """Runs a behavioural test file and folds its PASS/FAIL lines into this report."""
    print(f"\n{title}")
    p = subprocess.run([sys.executable, os.path.join(HOOKS, script)], stdin=subprocess.DEVNULL,
                       capture_output=True, text=True, encoding="utf-8", timeout=300)
    failed = [l.strip() for l in p.stdout.splitlines() if l.startswith("  FAIL")]
    passed = sum(1 for l in p.stdout.splitlines() if l.startswith("  PASS"))
    ran = re.search(r"Ran (\d+) test", p.stderr)
    passed = passed or (int(ran.group(1)) if ran else 0)
    check(script, p.returncode == 0 and not failed,
          "؛ ".join(failed)[:300] or p.stderr.strip()[:200], info=f"{passed} حالة")


def test_nextjs_hooks():
    """Runs test_nextjs_hooks.py: every deny case is paired with an allow case."""
    print("\n🧱 هيكل Next.js و DRY")
    p = subprocess.run([sys.executable, os.path.join(HOOKS, "test_nextjs_hooks.py")],
                       capture_output=True, text=True, encoding="utf-8")
    failed = [l.strip() for l in p.stdout.splitlines() if l.startswith("  FAIL")]
    passed = sum(1 for l in p.stdout.splitlines() if l.startswith("  PASS"))
    check("enforce-nextjs-structure + warn-duplication", p.returncode == 0 and not failed,
          "؛ ".join(failed)[:300] or p.stderr.strip()[:200], info=f"{passed} حالة")


def main():
    print("=" * 74)
    print("  تحقّق سلوكي من الـ hooks — تشغيل فعلي بمُدخلات حقيقية، لا قراءة ملفات")
    print("=" * 74)
    test_team_reminder()
    test_nextjs_hooks()
    test_suite("🗂  التخزين جوه المشروع (.agents/)", "test_project_storage.py")
    test_suite("🔐 فحص الأسرار قبل الـ commit", "test_scan_secrets.py")
    test_suite("👤 الـ profile والحقن", "test_kit_config.py")
    test_suite("💉 inject-rules", "test_inject_rules.py")
    test_suite("🩺 doctor", "test_doctor.py")
    test_suite("📊 عدّاد التوكنز", "test_usage.py")
    test_suite("📏 حد القراءة + تذكير التحقق", "test_budget_and_verify.py")
    test_suite("🧭 ملخص المشروع", "test_project_brief.py")
    test_registration()
    test_sounds()
    test_adapter()
    test_frontmatter()
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
