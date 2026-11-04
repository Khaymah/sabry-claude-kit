#!/usr/bin/env python3
"""
Cross-platform notification sound for agent hooks.

    python3 sounds/play.py done.wav

Resolves the file next to this script, so it works from a plugin install, a symlinked
~/.claude, or a plain clone. Uses only what the OS ships with:

    Windows  winsound (stdlib)
    macOS    afplay
    Linux    paplay / pw-play / aplay / ffplay (first one found)

Silent and exit-0 when there is nothing to play on: a cloud session, CI, SSH without
audio, a missing file, or SABRY_KIT_SOUNDS=0. A sound is never worth failing a hook.
"""
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

LINUX_PLAYERS = (
    ("paplay",),
    ("pw-play",),
    ("aplay", "-q"),
    ("ffplay", "-nodisp", "-autoexit", "-loglevel", "quiet"),
)


def muted():
    if os.environ.get("SABRY_KIT_SOUNDS", "1").strip().lower() in ("0", "false", "off", "no"):
        return True
    if os.environ.get("CLAUDE_CODE_REMOTE") or os.environ.get("CI"):
        return True
    return False


def play(path):
    if sys.platform == "win32":
        import winsound
        winsound.PlaySound(path, winsound.SND_FILENAME)
        return
    if sys.platform == "darwin":
        cmd = ("afplay",)
    else:
        cmd = next((p for p in LINUX_PLAYERS if shutil.which(p[0])), None)
        if cmd is None:
            return
    subprocess.run(cmd + (path,), stdin=subprocess.DEVNULL,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15)


def main():
    if len(sys.argv) < 2 or muted():
        return 0
    name = os.path.basename(sys.argv[1])
    path = os.path.join(HERE, name)
    if not os.path.isfile(path):
        return 0
    try:
        play(path)
    except Exception:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
