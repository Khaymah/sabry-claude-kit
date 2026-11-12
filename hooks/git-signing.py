#!/usr/bin/env python3
"""
SessionStart hook — commits are signed with the owner's own SSH key in every session.

Cloud containers start empty, so a key made in one session is gone in the next. The owner
keeps one dedicated signing key in the environment variable SABRY_SIGNING_KEY (the OpenSSH
private key, base64 on one line) and adds its public half to GitHub once, as a Signing Key.
This hook writes the key to ~/.ssh/sabry_signing (0600), derives the public half, and sets
the global git config: gpg.format ssh, user.signingkey, commit.gpgsign, tag.gpgsign and an
allowed_signers file for the commit email, so `git log --show-signature` checks locally too.
It also points gpg.ssh.program at ssh-keygen: cloud sessions ship one that signs with the
platform's own key, which GitHub only accepts for its noreply address, not the owner's key.

  - variable missing                 -> nothing, silently
  - ssh-keygen not installed         -> one line saying so (cloud images may lack it)
  - variable holds the PUBLIC key    -> one line explaining which half goes where
  - variable not a valid private key -> one line saying so; git is not touched
  - same key already in place        -> config refreshed, key file left as is

The key is never printed; only its SHA256 fingerprint is.

Switch: settings.git_signing (default on). Wired to: SessionStart, after git-identity.
"""
import base64
import binascii
import json
import os
import shutil
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    import kit_config
except Exception:
    kit_config = None

VARIABLE = "SABRY_SIGNING_KEY"
KEY_NAME = "sabry_signing"
PEM_HEADER = b"-----BEGIN OPENSSH PRIVATE KEY-----"


def git(*args):
    try:
        p = subprocess.run(["git", *args], capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=5)
        return p.stdout.strip() if p.returncode == 0 else ""
    except Exception:
        return ""


def decode(raw):
    text = "".join(raw.split())
    try:
        key = base64.b64decode(text, validate=True)
    except (binascii.Error, ValueError):
        key = raw.encode("utf-8", "replace")
    key = key.replace(b"\r\n", b"\n").strip() + b"\n"
    return key if key.startswith(PEM_HEADER) else None


def public_half(path):
    try:
        p = subprocess.run(["ssh-keygen", "-y", "-f", path], capture_output=True, text=True,
                           timeout=10, stdin=subprocess.DEVNULL)
    except Exception:
        return ""
    line = p.stdout.strip()
    return line if p.returncode == 0 and line.startswith("ssh-") else ""


def fingerprint(pub_path):
    try:
        p = subprocess.run(["ssh-keygen", "-l", "-f", pub_path], capture_output=True, text=True,
                           timeout=10, stdin=subprocess.DEVNULL)
    except Exception:
        return ""
    parts = p.stdout.split()
    return parts[1] if p.returncode == 0 and len(parts) > 1 else ""


def write_private(path, key):
    try:
        with open(path, "rb") as f:
            if f.read() == key:
                os.chmod(path, 0o600)
                return
    except OSError:
        pass
    tmp = path + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(key)
    os.replace(tmp, path)


def install(key, email):
    ssh_dir = os.path.join(os.path.expanduser("~"), ".ssh")
    os.makedirs(ssh_dir, mode=0o700, exist_ok=True)
    os.chmod(ssh_dir, 0o700)
    private = os.path.join(ssh_dir, KEY_NAME)
    write_private(private, key)
    pub = public_half(private)
    if not pub:
        return None
    pub_path = private + ".pub"
    with open(pub_path, "w", encoding="utf-8") as f:
        f.write(pub + "\n")
    signers = os.path.join(ssh_dir, "allowed_signers")
    with open(signers, "w", encoding="utf-8") as f:
        f.write(f"{email or '*'} {pub}\n")
    git("config", "--global", "gpg.format", "ssh")
    git("config", "--global", "gpg.ssh.program", shutil.which("ssh-keygen") or "ssh-keygen")
    git("config", "--global", "user.signingkey", pub_path)
    git("config", "--global", "commit.gpgsign", "true")
    git("config", "--global", "tag.gpgsign", "true")
    git("config", "--global", "gpg.ssh.allowedSignersFile", signers)
    return fingerprint(pub_path) or "unknown"


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        payload = {}
    if not isinstance(payload, dict):
        payload = {}

    raw = os.environ.get(VARIABLE, "").strip()
    if not raw:
        return 0
    if shutil.which("git") is None:
        return 0
    if kit_config and not kit_config.gate("git_signing", payload):
        return 0
    if shutil.which("ssh-keygen") is None:
        print(f"[git-signing] ssh-keygen is not installed here, so {VARIABLE} cannot be used and commits "
              "are not signed with the owner's key. Install openssh-client (in a cloud environment, add "
              "`apt-get install -y openssh-client` to its setup script).")
        return 0
    if raw.startswith(("ssh-", "ecdsa-", "sk-ssh-", "sk-ecdsa-")):
        print(f"[git-signing] {VARIABLE} holds a PUBLIC key; it needs the PRIVATE key, base64 on one line "
              "(`base64 -w0 ~/.ssh/<key>`, on macOS `base64 -i ~/.ssh/<key>`). The public half goes to "
              "GitHub → Settings → SSH and GPG keys → New SSH key → type Signing Key. Commits are not signed.")
        return 0

    key = decode(raw)
    if key is None:
        print(f"[git-signing] {VARIABLE} is not an OpenSSH private key (base64 or PEM); "
              "commits are not signed. Fix the variable in the environment settings.")
        return 0
    email = git("config", "--global", "user.email")
    try:
        found = install(key, email)
    except OSError as err:
        print(f"[git-signing] could not install the signing key: {err.strerror or err}")
        return 0
    if not found:
        print(f"[git-signing] {VARIABLE} could not be read by ssh-keygen (a passphrase?); "
              "commits are not signed.")
        return 0
    print(f"[git-signing] Commits are signed with the key from {VARIABLE} ({found}).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
