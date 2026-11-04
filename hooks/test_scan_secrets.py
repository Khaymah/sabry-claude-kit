"""Behavioural tests for scan-secrets.py. Secrets are assembled at runtime so this file
never contains one and never trips the scanner it tests."""
import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
HOOK = os.path.join(HERE, "scan-secrets.py")
J = "".join

SECRETS = {
    "AWS access key": J(["AKIA", "Q3EGRIZ7XK2M5VQP"]),
    "GitHub token": J(["ghp_", "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8"]),
    "Anthropic API key": J(["sk-ant-", "api03-", "Zx9Yw8Vu7Ts6Rq5Po4Nm3Lk2"]),
    "OpenAI API key": J(["sk-proj-", "Ab12Cd34Ef56Gh78Ij90Kl12Mn34Op56Qr"]),
    "Slack token": J(["xoxb-", "123456789012-abcdefGHIJKL"]),
    "Stripe live key": J(["sk_", "live_", "51HxYzAbCdEfGhIjKlMnOpQr"]),
    "Google API key": J(["AIza", "SyB1c2D3e4F5g6H7i8J9k0L1m2N3o4P5q6R"]),
    "Private key": J(["-----BEGIN ", "RSA PRIVATE", " KEY-----"]),
    "Password in URL": J(["postgres://admin:", "Kq83jdLw0p", "@db.internal:5432/app"]),
}
FAILED = []


def check(label, ok, detail=""):
    print(f"  {'PASS' if ok else 'FAIL'} {label}" + ("" if ok else f"  -> {detail}"))
    if not ok:
        FAILED.append(label)


def run(args=(), stdin=None, cwd=None):
    p = subprocess.run([sys.executable, HOOK] + list(args), input=stdin, capture_output=True,
                       text=True, cwd=cwd, timeout=60)
    return p.returncode, p.stdout, p.stderr


def scan_file(tmp, name, text):
    path = os.path.join(tmp, name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)
    rc, out, _ = run([path])
    return rc, out


def git(repo, *args):
    return subprocess.run(["git", "-C", repo] + list(args), capture_output=True, text=True)


def main():
    tmp = tempfile.mkdtemp()
    try:
        print("rules")
        for kind, value in SECRETS.items():
            rc, out = scan_file(tmp, "a.txt", f"value = {value}\n")
            check(f"{kind} detected", rc == 1 and kind in out, out.strip()[:80])
            check(f"{kind} masked", value not in out, "raw value printed")

        rc, out = scan_file(tmp, "b.ts", 'const apiKey = "' + J(["Hq7", "Lp2Xz9Wm4Rt8Kd"]) + '"\n')
        check("hard-coded apiKey detected", rc == 1, out)

        print("no false positives")
        clean = [
            ('password = "changeme"', "placeholder"),
            ('const token = process.env.API_TOKEN', "env reference"),
            ('DATABASE_URL=postgres://user:${DB_PASS}@localhost/db', "interpolated password"),
            ('secret: "<your-secret-here>"', "angle placeholder"),
            ('api_key = "xxxxxxxxxxxxxxxx"', "masked value"),
            ('hash = "3f786850e387550fdab836ed7e6dc881de23001b"', "plain sha1"),
            (f"value = {SECRETS['GitHub token']}  # allow-secret", "inline allow"),
        ]
        for text, label in clean:
            rc, out = scan_file(tmp, "c.txt", text + "\n")
            check(f"clean: {label}", rc == 0, out.strip()[:80])

        print("allowlist file")
        os.makedirs(os.path.join(tmp, ".agents"), exist_ok=True)
        with open(os.path.join(tmp, ".agents", "secrets-allowlist"), "w") as fh:
            fh.write("AKIAQ3EGRIZ7\n")
        with open(os.path.join(tmp, "d.txt"), "w") as fh:
            fh.write(f"k={SECRETS['AWS access key']}\n")
        p = subprocess.run([sys.executable, HOOK, "d.txt"], cwd=tmp, capture_output=True, text=True)
        check("allowlisted value passes", p.returncode == 0, p.stdout)

        print("git pre-commit + Claude hook")
        repo = os.path.join(tmp, "repo")
        os.makedirs(repo)
        git(repo, "init", "-q", "-b", "main")
        git(repo, "config", "user.email", "t@t.t")
        git(repo, "config", "user.name", "t")
        with open(os.path.join(repo, "ok.txt"), "w") as fh:
            fh.write("hello\n")
        git(repo, "add", "-A")
        rc, _, err = run(["--git-pre-commit"], cwd=repo)
        check("clean staged → pass", rc == 0, err)

        with open(os.path.join(repo, ".agents-note.md"), "w") as fh:
            fh.write(f"token {SECRETS['GitHub token']}\n")
        git(repo, "add", "-A")
        rc, _, err = run(["--git-pre-commit"], cwd=repo)
        check("staged secret → blocked", rc == 1 and "GitHub token" in err, err)

        payload = {"tool_name": "Bash", "cwd": repo, "tool_input": {"command": 'git commit -m "feat: x"'}}
        rc, out, _ = run(stdin=json.dumps(payload))
        try:
            decision = json.loads(out)["hookSpecificOutput"]["permissionDecision"]
        except Exception:
            decision = None
        check("Claude hook: git commit with staged secret → deny", decision == "deny", out[:80])

        payload["tool_input"]["command"] = "git status"
        rc, out, _ = run(stdin=json.dumps(payload))
        check("Claude hook: not a commit → silent", rc == 0 and out == "", out)

        git(repo, "reset", "-q")
        payload["tool_input"]["command"] = 'git commit -am "feat: y"'
        git(repo, "add", "ok.txt")
        git(repo, "commit", "-q", "-m", "seed")
        with open(os.path.join(repo, "ok.txt"), "a") as fh:
            fh.write(f"{SECRETS['Slack token']}\n")
        rc, out, _ = run(stdin=json.dumps(payload))
        check("Claude hook: commit -a scans unstaged tracked changes", '"deny"' in out, out[:80])

        git(repo, "checkout", "-q", "--", "ok.txt")
        with open(os.path.join(repo, ".env"), "w") as fh:
            fh.write("A=1\n")
        with open(os.path.join(repo, ".env.example"), "w") as fh:
            fh.write("A=\n")
        git(repo, "add", ".env.example")
        rc, _, err = run(["--git-pre-commit"], cwd=repo)
        check(".env.example → allowed", rc == 0, err)
        git(repo, "add", "-f", ".env")
        rc, _, err = run(["--git-pre-commit"], cwd=repo)
        check(".env committed → blocked", rc == 1 and "Sensitive file" in err, err)

        rc, out, _ = run(stdin="not json")
        check("malformed payload → silent", rc == 0 and out == "", out)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    print(f"\n{len(FAILED)} FAILED" + (": " + "; ".join(FAILED) if FAILED else ""))
    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main())
