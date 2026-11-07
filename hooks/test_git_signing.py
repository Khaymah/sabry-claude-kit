# -*- coding: utf-8 -*-
"""Test suite for git-signing.py. Every case runs with its own HOME, global git config and
freshly generated key, so the machine's real ~/.ssh and git config never decide a result."""
import base64, io, json, os, shutil, stat, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
HOOK = os.path.join(HERE, "git-signing.py")
FIX = os.path.join(HERE, "signingfix")
EMAIL = "jane@example.dev"


def _force_writable(func, path, _):
    os.chmod(path, stat.S_IWRITE)
    func(path)


def teardown():
    if os.path.exists(FIX):
        shutil.rmtree(FIX, onexc=_force_writable)


def env_for(case_dir, extra=None):
    env = {k: v for k, v in os.environ.items()
           if not k.startswith(("GIT_AUTHOR_", "GIT_COMMITTER_", "SABRY_KIT_", "GIT_CONFIG",
                                "SABRY_SIGNING_KEY"))}
    env.update(HOME=os.path.join(case_dir, "home"),
               GIT_CONFIG_GLOBAL=os.path.join(case_dir, "global.gitconfig"),
               GIT_CONFIG_NOSYSTEM="1",
               SABRY_KIT_PROFILE=os.path.join(case_dir, "profile.json"),
               CLAUDE_CONFIG_DIR=case_dir)
    env.update(extra or {})
    return env


def make_key(case_dir, passphrase=""):
    path = os.path.join(case_dir, "source_key")
    subprocess.run(["ssh-keygen", "-q", "-t", "ed25519", "-N", passphrase, "-C", "test",
                    "-f", path], check=True, capture_output=True)
    pem = io.open(path, "rb").read()
    pub = io.open(path + ".pub").read().split()[1]
    return pem, pub


def make_case(slug):
    case_dir = os.path.join(FIX, slug)
    os.makedirs(os.path.join(case_dir, "home"))
    io.open(os.path.join(case_dir, "global.gitconfig"), "w").write(
        "[user]\n\tname = Jane Doe\n\temail = %s\n[gpg \"ssh\"]\n\tprogram = /tmp/code-sign\n" % EMAIL)
    io.open(os.path.join(case_dir, "profile.json"), "w").write(json.dumps({}))
    return case_dir


def config(case_dir, key):
    p = subprocess.run(["git", "config", "--global", key], env=env_for(case_dir),
                       capture_output=True, text=True)
    return p.stdout.strip()


def run_hook(case_dir, extra_env):
    p = subprocess.run([sys.executable, HOOK], input=json.dumps({"cwd": case_dir}),
                       capture_output=True, text=True, encoding="utf-8",
                       env=env_for(case_dir, extra_env))
    return p.returncode, p.stdout + p.stderr


def installed(case_dir, pub):
    private = os.path.join(case_dir, "home", ".ssh", "sabry_signing")
    if not os.path.exists(private):
        return False
    mode_ok = stat.S_IMODE(os.stat(private).st_mode) == 0o600
    pub_ok = pub in io.open(private + ".pub").read()
    signers = io.open(os.path.join(case_dir, "home", ".ssh", "allowed_signers")).read()
    return (mode_ok and pub_ok and signers.startswith(EMAIL + " ")
            and config(case_dir, "gpg.format") == "ssh"
            and config(case_dir, "gpg.ssh.program").endswith("ssh-keygen")
            and config(case_dir, "commit.gpgsign") == "true"
            and config(case_dir, "tag.gpgsign") == "true"
            and config(case_dir, "user.signingkey") == private + ".pub")


def untouched(case_dir):
    return (not os.path.exists(os.path.join(case_dir, "home", ".ssh", "sabry_signing"))
            and config(case_dir, "commit.gpgsign") == "" and config(case_dir, "gpg.format") == "")


def leaks(out, pem):
    body = b"".join(pem.split(b"\n")[1:-2]).decode()
    return body[:24] in out or base64.b64encode(pem).decode()[:24] in out


def signs(case_dir):
    repo = os.path.join(case_dir, "repo")
    env = env_for(case_dir)
    subprocess.run(["git", "init", "-q", repo], env=env, check=True)
    subprocess.run(["git", "-C", repo, "commit", "-q", "--allow-empty", "-m", "test: signed"],
                   env=env, check=True, capture_output=True)
    p = subprocess.run(["git", "-C", repo, "log", "-1", "--format=%G?"], env=env,
                       capture_output=True, text=True)
    return p.stdout.strip() == "G"


def case_base64(case_dir):
    pem, pub = make_key(case_dir)
    code, out = run_hook(case_dir, {"SABRY_SIGNING_KEY": base64.b64encode(pem).decode()})
    return code == 0 and installed(case_dir, pub) and "SHA256:" in out and not leaks(out, pem) \
        and signs(case_dir)


def case_raw_pem(case_dir):
    pem, pub = make_key(case_dir)
    code, out = run_hook(case_dir, {"SABRY_SIGNING_KEY": pem.decode()})
    return code == 0 and installed(case_dir, pub) and not leaks(out, pem)


def case_twice(case_dir):
    pem, pub = make_key(case_dir)
    value = {"SABRY_SIGNING_KEY": base64.b64encode(pem).decode()}
    first = run_hook(case_dir, value)
    second = run_hook(case_dir, value)
    return first[0] == 0 and second[0] == 0 and installed(case_dir, pub)


def case_missing(case_dir):
    code, out = run_hook(case_dir, {})
    return code == 0 and out.strip() == "" and untouched(case_dir)


def case_garbage(case_dir):
    code, out = run_hook(case_dir, {"SABRY_SIGNING_KEY": "bm90IGEga2V5"})
    return code == 0 and "not an OpenSSH private key" in out and untouched(case_dir)


def case_passphrase(case_dir):
    pem, _ = make_key(case_dir, passphrase="secret phrase")
    code, out = run_hook(case_dir, {"SABRY_SIGNING_KEY": base64.b64encode(pem).decode()})
    return (code == 0 and "could not be read" in out and config(case_dir, "commit.gpgsign") == ""
            and not leaks(out, pem))


def case_switch_off(case_dir):
    pem, _ = make_key(case_dir)
    code, out = run_hook(case_dir, {"SABRY_SIGNING_KEY": base64.b64encode(pem).decode(),
                                    "SABRY_KIT_GIT_SIGNING": "0"})
    return code == 0 and out.strip() == "" and untouched(case_dir)


CASES = [
    ("base64-key-installed-and-signs", case_base64),
    ("raw-pem-key-installed", case_raw_pem),
    ("second-run-keeps-it-working", case_twice),
    ("no-variable-silent", case_missing),
    ("not-a-key-refused", case_garbage),
    ("passphrase-key-not-used", case_passphrase),
    ("switch-off", case_switch_off),
]


def main():
    if shutil.which("ssh-keygen") is None:
        print("SKIP  ssh-keygen is not installed")
        return 0
    teardown()
    fails = 0
    try:
        for slug, case in CASES:
            ok = case(make_case(slug))
            fails += not ok
            print(f"{'PASS' if ok else 'FAIL'}  {slug}")
    finally:
        teardown()
    print("\nfailures:", fails)
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
