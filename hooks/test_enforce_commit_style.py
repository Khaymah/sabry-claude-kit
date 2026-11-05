# -*- coding: utf-8 -*-
"""Test suite for enforce-commit-style.py. Kept in a file, not a heredoc: the cases
themselves contain commit-shaped text that the hook would (correctly) flag."""
import io, json, os, shutil, stat, subprocess, sys

HOOK = os.path.join(os.path.dirname(os.path.abspath(__file__)), "enforce-commit-style.py")
TRAILER = "Co-Authored-By: " + "Claude Opus 5 <noreply@anthropic.com>"
GENERATED = "\U0001F916 " + "Generated with Claude Code"
ARABIC_SUBJECT = "F2: \u0645\u0643\u062a\u0628\u0629 \u0627\u0644\u0645\u0643\u0648\u0651\u0646\u0627\u062a"

HERE = os.path.dirname(os.path.abspath(__file__))
FIX = os.path.join(HERE, "hookfix")
REPO = os.path.join(FIX, "repo")
AI_REPO = os.path.join(FIX, "ai-repo")
AI_HEAD_REPO = os.path.join(FIX, "ai-head-repo")
GLOBAL_CONFIG = os.path.join(FIX, "global.gitconfig")
EMPTY_PROFILE = os.path.join(FIX, "profile.json")
AI_NAME, AI_EMAIL = "Claude", "bot@example.dev"


def hermetic_env():
    """Run git and the hook against fixture config only: a cloud session's global
    `Claude <noreply@anthropic.com>` identity must not decide the result of a case."""
    env = {k: v for k, v in os.environ.items()
           if not k.startswith(("GIT_AUTHOR_", "GIT_COMMITTER_", "SABRY_KIT_"))}
    env.update(GIT_CONFIG_GLOBAL=GLOBAL_CONFIG, GIT_CONFIG_NOSYSTEM="1",
               SABRY_KIT_PROFILE=EMPTY_PROFILE, CLAUDE_CONFIG_DIR=FIX)
    return env


def _repo(path, name, email):
    g = lambda *a: subprocess.run(("git", "-C", path) + a, capture_output=True, text=True,
                                  env=hermetic_env())
    os.makedirs(path)
    g("init", "-q", "-b", "main")
    g("config", "user.email", email)
    g("config", "user.name", name)
    io.open(os.path.join(path, "a.txt"), "w").write("x")
    g("add", "-A")
    return g


def _force_writable(func, path, _):
    os.chmod(path, stat.S_IWRITE)
    func(path)


def teardown():
    """Git marks object files read-only; on Windows plain rmtree fails on them silently."""
    if os.path.exists(FIX):
        shutil.rmtree(FIX, onexc=_force_writable)


def setup():
    """Message files for -F, a repo whose HEAD carries a banned trailer, a repo configured
    as Claude, and a human repo whose HEAD was authored by Claude."""
    teardown()
    os.makedirs(FIX)
    write = lambda n, t: io.open(os.path.join(FIX, n), "w", encoding="utf-8").write(t)
    write("clean.txt", "feat: add product rail\n\nEnglish body, nothing banned.\n")
    write("trailer.txt", "feat: add product rail\n\n%s\n" % TRAILER)
    write("arabic.txt", ARABIC_SUBJECT + "\n")
    write("global.gitconfig", "[user]\n\tname = Jane Doe\n\temail = jane@example.dev\n")
    write("profile.json", "{}\n")

    _repo(REPO, "t", "t@t.t")("commit", "-q", "-m", "feat: seed\n\n%s" % TRAILER)
    _repo(AI_REPO, AI_NAME, AI_EMAIL)("commit", "-q", "-m", "feat: seed")
    _repo(AI_HEAD_REPO, "Jane Doe", "jane@example.dev")(
        "commit", "-q", "--author=%s <%s>" % (AI_NAME, AI_EMAIL), "-m", "feat: seed")


def cases():
    f = lambda n: os.path.join(FIX, n).replace("\\", "/")
    return [
        # --- original 14 -------------------------------------------------------
        ("python heredoc writing a fixture that commits, plus arabic",
         "python3 - <<'PY'\nopen('f.sh','w').write(\"git add -A && git commit -q -m seed\")\nprint('%s')\nPY"
         % ARABIC_SUBJECT,                                                                      None),
        ("cat heredoc writing a script that commits arabic",
         "cat > s.sh <<'EOF'\ngit commit -m \"%s\"\nEOF" % ARABIC_SUBJECT,                     None),
        ("bash heredoc that really commits arabic",
         "bash <<'EOF'\ngit commit -m \"%s\"\nEOF" % ARABIC_SUBJECT,                            "deny"),
        ("commit -F - heredoc with trailer",
         "git commit -F - <<'EOF'\nfeat: x\n\n%s\nEOF" % TRAILER,                              "deny"),
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

        # --- rule 3: the recorded author/committer must not be an AI ------------
        ("repo configured as Claude",
         'git -C "%s" commit -m "feat: x"' % AI_REPO.replace("\\", "/"),                       "deny"),
        ("cd into repo configured as Claude",
         'cd "%s" && git commit -m "feat: x"' % AI_REPO.replace("\\", "/"),                    "deny"),
        ("--author is Claude",
         'git commit --author="%s <%s>" -m "feat: x"' % (AI_NAME, AI_EMAIL),                  "deny"),
        ("GIT_AUTHOR_NAME=Claude prefix",
         'GIT_AUTHOR_NAME=%s git commit -m "feat: x"' % AI_NAME,                               "deny"),
        ("quoted GIT_COMMITTER_NAME prefix",
         'GIT_COMMITTER_NAME="%s Bot" git commit -m "feat: x"' % AI_NAME,                     "deny"),
        ("git -c user.name=Claude",
         'git -c user.name=%s commit -m "feat: x"' % AI_NAME,                                  "deny"),
        ("git -c with a quoted human name",
         'git -c user.name="Jane Doe" commit -m "feat: x"',                                    None),
        ("anthropic email in the config identity",
         'git -c user.email=ai@anthropic.dev commit -m "feat: x"',                             "deny"),
        ("human --author override",
         'git commit --author="Jane Doe <jane@example.dev>" -m "feat: x"',                     None),
        ("human --author but the committer config is AI",
         'git -C "%s" commit --author="Jane Doe <jane@example.dev>" -m "feat: x"'
         % AI_REPO.replace("\\", "/"),                                                         "deny"),
        ("a name that merely contains claude",
         'git commit --author="Claudette Roy <c@example.dev>" -m "feat: x"',                   None),
        ("amend keeps an AI HEAD author",
         'git -C "%s" commit --amend -m "feat: seed"' % AI_HEAD_REPO.replace("\\", "/"),       "deny"),
        ("amend with --reset-author takes the human config",
         'git -C "%s" commit --amend --reset-author -m "feat: seed"'
         % AI_HEAD_REPO.replace("\\", "/"),                                                    None),
        ("non-commit git in an AI repo is untouched",
         'git -C "%s" status' % AI_REPO.replace("\\", "/"),                                    None),
    ]


def main() -> int:
    setup()
    try:
        return run_cases()
    finally:
        teardown()


def run_cases() -> int:
    fails = 0
    for name, cmd, expect in cases():
        p = subprocess.run([sys.executable, HOOK],
                           input=json.dumps({"tool_input": {"command": cmd}, "cwd": FIX}),
                           capture_output=True, text=True, encoding="utf-8", env=hermetic_env())
        out = (p.stdout or "").strip()
        got = json.loads(out)["hookSpecificOutput"]["permissionDecision"] if out else None
        ok = got == expect
        fails += not ok
        print(f"{'PASS' if ok else 'FAIL'}  {name:36s} expected={expect}  got={got}")
    print("\nfailures:", fails)
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
