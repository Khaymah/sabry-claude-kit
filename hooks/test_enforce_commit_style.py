# -*- coding: utf-8 -*-
"""Test suite for enforce-commit-style.py. Kept in a file, not a heredoc: the cases
themselves contain commit-shaped text that the hook would (correctly) flag."""
import io, json, os, shutil, subprocess, sys

HOOK = r"C:\Users\PC\.claude\hooks\enforce-commit-style.py"
TRAILER = "Co-Authored-By: " + "Claude Opus 5 <noreply@anthropic.com>"
GENERATED = "\U0001F916 " + "Generated with Claude Code"
ARABIC_SUBJECT = "F2: \u0645\u0643\u062a\u0628\u0629 \u0627\u0644\u0645\u0643\u0648\u0651\u0646\u0627\u062a"

HERE = os.path.dirname(os.path.abspath(__file__))
FIX = os.path.join(HERE, "hookfix")
REPO = os.path.join(FIX, "repo")


def setup():
    """Message files for -F, plus a real repo whose HEAD carries a banned trailer."""
    shutil.rmtree(FIX, ignore_errors=True)
    os.makedirs(REPO)
    write = lambda n, t: io.open(os.path.join(FIX, n), "w", encoding="utf-8").write(t)
    write("clean.txt", "feat: add product rail\n\nEnglish body, nothing banned.\n")
    write("trailer.txt", "feat: add product rail\n\n%s\n" % TRAILER)
    write("arabic.txt", ARABIC_SUBJECT + "\n")

    g = lambda *a: subprocess.run(("git", "-C", REPO) + a, capture_output=True, text=True)
    g("init", "-q", "-b", "main")
    g("config", "user.email", "t@t.t")
    g("config", "user.name", "t")
    io.open(os.path.join(REPO, "a.txt"), "w").write("x")
    g("add", "-A")
    g("commit", "-q", "-m", "feat: seed\n\n%s" % TRAILER)


def cases():
    f = lambda n: os.path.join(FIX, n).replace("\\", "/")
    return [
        # --- original 14 -------------------------------------------------------
        ("clean english commit",       'git commit -m "feat(ui): add product rail"',           None),
        ("chained after &&",           'git add -A && git commit -m "fix: x"',                 None),
        ("multiline, second command",  'echo hi\ngit commit -m "feat: y"',                     None),
        ("env prefix",                 'GIT_AUTHOR_NAME=x git commit -m "feat: y"',            None),
        ("attribution trailer (heredoc)",
         'git commit -m "$(cat <<\'EOF\'\nfeat: x\n\n%s\nEOF\n)"' % TRAILER,                   "deny"),
        ("attribution trailer (-m)",   'git commit -m "feat: x\n\n%s"' % TRAILER,              "deny"),
        ("robot emoji in PR body",     'gh pr create --body "x\n\n%s"' % GENERATED,            "deny"),
        ("arabic -m message",          'git commit -m "%s"' % ARABIC_SUBJECT,                  "deny"),
        ("arabic heredoc body",
         'git commit -m "$(cat <<\'EOF\'\nfeat: rail\n\n\u0627\u0644\u0627\u062a\u062c\u0627\u0647\nEOF\n)"', "deny"),
        ("arabic path but english msg",
         'git commit -m "chore: move" -- "d:/Work/\u0645\u0634\u0631\u0648\u0639/x.ts"',       None),
        ("not a commit at all",        'git status && grep -rn "Claude" .',                    None),
        ("git log",                    'git log --oneline -3',                                 None),
        ("prose mentioning git commit",
         'python edit.py  # rewrites docs that say: git commit  and quote %s' % TRAILER,       None),
        ("grep for the trailer",       'grep -rn "%s" .' % TRAILER,                            None),

        # --- -F / --file: the message lives in a file, not in the command ------
        ("-F clean file",              'git commit -F "%s"' % f("clean.txt"),                  None),
        ("-F file with trailer",       'git commit -F "%s"' % f("trailer.txt"),                "deny"),
        ("-F file with arabic",        'git commit -F "%s"' % f("arabic.txt"),                 "deny"),
        ("--file= with arabic",        'git commit --file="%s"' % f("arabic.txt"),             "deny"),
        ("-F after cd, relative path",
         'cd "%s" && git commit -F arabic.txt' % FIX.replace("\\", "/"),                       "deny"),
        ("-F unreadable path fails open",
         'git commit -F "%s"' % f("does-not-exist.txt"),                                       None),
        ("gh --body-file with trailer",
         'gh pr create --body-file "%s"' % f("trailer.txt"),                                   "deny"),

        # --- inherited messages: --amend / -C reuse text never typed -----------
        ("amend --no-edit inherits trailer",
         'git -C "%s" commit --amend --no-edit' % REPO.replace("\\", "/"),                     "deny"),
        ("amend with clean new message",
         'git -C "%s" commit --amend -m "feat: seed"' % REPO.replace("\\", "/"),               None),
        ("amend outside any repo fails open",
         'git -C "%s" commit --amend --no-edit' % f("nope"),                                   None),
    ]


def main() -> int:
    setup()
    fails = 0
    for name, cmd, expect in cases():
        p = subprocess.run([sys.executable, HOOK],
                           input=json.dumps({"tool_input": {"command": cmd}, "cwd": HERE}),
                           capture_output=True, text=True, encoding="utf-8")
        out = (p.stdout or "").strip()
        got = json.loads(out)["hookSpecificOutput"]["permissionDecision"] if out else None
        ok = got == expect
        fails += not ok
        print(f"{'PASS' if ok else 'FAIL'}  {name:36s} expected={expect}  got={got}")
    print("\nfailures:", fails)
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
