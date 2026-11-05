# -*- coding: utf-8 -*-
"""Test suite for git-identity.py. Every case runs against its own fixture global config,
profile and repository, so the machine's real git identity never decides a result."""
import io, json, os, shutil, stat, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
HOOK = os.path.join(HERE, "git-identity.py")
FIX = os.path.join(HERE, "identityfix")
OWNER = ("Jane Doe", "jane@example.dev")
AI = ("Claude", "noreply@anthropic.com")


def _force_writable(func, path, _):
    os.chmod(path, stat.S_IWRITE)
    func(path)


def teardown():
    if os.path.exists(FIX):
        shutil.rmtree(FIX, onexc=_force_writable)


def env_for(case_dir, extra=None):
    env = {k: v for k, v in os.environ.items()
           if not k.startswith(("GIT_AUTHOR_", "GIT_COMMITTER_", "SABRY_KIT_", "GIT_CONFIG"))}
    env.update(GIT_CONFIG_GLOBAL=os.path.join(case_dir, "global.gitconfig"),
               GIT_CONFIG_NOSYSTEM="1",
               SABRY_KIT_PROFILE=os.path.join(case_dir, "profile.json"),
               CLAUDE_CONFIG_DIR=case_dir)
    env.update(extra or {})
    return env


def make_case(slug, global_identity, profile_identity, local_identity=None):
    case_dir = os.path.join(FIX, slug)
    repo = os.path.join(case_dir, "repo")
    os.makedirs(repo)
    body = ""
    if global_identity:
        body = "[user]\n\tname = %s\n\temail = %s\n" % global_identity
    io.open(os.path.join(case_dir, "global.gitconfig"), "w").write(body)
    profile = {}
    if profile_identity:
        profile = {"git_name": profile_identity[0], "git_email": profile_identity[1]}
    io.open(os.path.join(case_dir, "profile.json"), "w").write(json.dumps(profile))
    env = env_for(case_dir)
    subprocess.run(["git", "-C", repo, "init", "-q"], env=env, capture_output=True)
    if local_identity:
        subprocess.run(["git", "-C", repo, "config", "user.name", local_identity[0]], env=env)
        subprocess.run(["git", "-C", repo, "config", "user.email", local_identity[1]], env=env)
    return case_dir, repo


def read(case_dir, repo, scope):
    env = env_for(case_dir)
    args = ["git", "-C", repo, "config", scope]
    name = subprocess.run(args + ["user.name"], env=env, capture_output=True, text=True).stdout.strip()
    email = subprocess.run(args + ["user.email"], env=env, capture_output=True, text=True).stdout.strip()
    return (name, email) if name or email else None


def run_hook(case_dir, repo, extra_env=None):
    p = subprocess.run([sys.executable, HOOK], input=json.dumps({"cwd": repo}),
                       capture_output=True, text=True, encoding="utf-8",
                       env=env_for(case_dir, extra_env))
    return p.returncode, p.stdout


CASES = [
    # slug, global, profile, local, extra env, expected global, expected local, output contains
    ("ai-global-gets-owner", AI, OWNER, None, None, OWNER, None, "Jane Doe"),
    ("empty-global-gets-owner", None, OWNER, None, None, OWNER, None, "global"),
    ("human-global-untouched", ("Sam Roe", "sam@example.dev"), OWNER, None, None,
     ("Sam Roe", "sam@example.dev"), None, ""),
    ("ai-global-no-profile-asks", AI, None, None, None, AI, None, "ask the owner"),
    ("empty-global-no-profile-silent", None, None, None, None, None, None, ""),
    ("ai-local-replaced", ("Sam Roe", "sam@example.dev"), OWNER, AI, None,
     ("Sam Roe", "sam@example.dev"), OWNER, "this repository"),
    ("human-local-untouched", AI, OWNER, ("Sam Roe", "sam@example.dev"), None,
     OWNER, ("Sam Roe", "sam@example.dev"), "global"),
    ("switch-off", AI, OWNER, None, {"SABRY_KIT_GIT_IDENTITY": "0"}, AI, None, ""),
    ("ai-profile-never-applied", AI, ("Claude", "c@example.dev"), None, None, AI, None,
     "ask the owner"),
]


def main():
    teardown()
    fails = 0
    try:
        for slug, glob, prof, local, extra, want_global, want_local, says in CASES:
            case_dir, repo = make_case(slug, glob, prof, local)
            code, out = run_hook(case_dir, repo, extra)
            got_global = read(case_dir, repo, "--global")
            got_local = read(case_dir, repo, "--local")
            ok = (code == 0 and got_global == want_global and got_local == want_local
                  and (says in out if says else out.strip() == ""))
            fails += not ok
            print(f"{'PASS' if ok else 'FAIL'}  {slug:32s} global={got_global} local={got_local}"
                  f"{'' if ok else '  output=' + repr(out.strip()[:120])}")
    finally:
        teardown()
    print("\nfailures:", fails)
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
