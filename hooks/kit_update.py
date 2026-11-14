#!/usr/bin/env python3
"""
SessionStart hook: tells an owner who already has a profile what a kit update changed.

An existing profile needs no migration. It stores only what the owner chose; every other
switch comes from DEFAULTS at read time, so a switch added by an update is on from the
first session and nothing the owner set is touched. What an update cannot do by itself:

  - tell the owner the new switches exist, so they can turn one off knowingly;
  - refresh the copies `kit_install.py` wrote into other tools (Codex, Kimi, OpenCode,
    Kilo Code, Cline): those are static until the command runs again.

So, once per kit version, this hook asks the agent to say in a few lines what is new,
which switches were added and which installs are stale, then records the version in the
local profile as `kit_version` (without touching `updated`, which decides whether the
local or the synced profile wins).

Quiet when there is no profile (kit-setup handles that), when the version was already
announced, and when the profile exists only as the synced `sabry-profile` skill: a cloud
container cannot remember the announcement, and repeating it in every session would be
noise. `kit_update.py status` prints the same information on demand.

Switch: SABRY_KIT_UPDATE_NOTICE=0. Exit 0 on any failure.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit_config

KIT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BEFORE_TRACKING = "0.2.0"
WHATS_NEW = {
    "0.3.0": {
        "summary": [
            "lessons: your corrections are recorded and shown again in later sessions",
            "long-task plans: a checkbox plan that survives session ends and compaction",
            "/sabry-kit:kit-orchestrate and eight new agents",
            "injected rules are about 40% shorter and now reach the model in full",
        ],
        "switches": ["lessons", "long_task_plans"],
    },
}


def parse(version):
    out = []
    for part in str(version or "").split("."):
        digits = "".join(c for c in part if c.isdigit())
        out.append(int(digits) if digits else 0)
    return tuple(out + [0] * (3 - len(out)))[:3]


def current_version():
    try:
        with open(os.path.join(KIT, ".claude-plugin", "plugin.json"), encoding="utf-8") as fh:
            return str(json.load(fh).get("version") or "")
    except Exception:
        return ""


def read_json(path):
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def stale_installs(current):
    manifest = read_json(os.path.join(kit_config.home(), kit_config.STORAGE_DIR, "sabry-kit-install.json"))
    return sorted(t for t, entry in manifest.items()
                  if isinstance(entry, dict) and parse(entry.get("version")) < parse(current))


def changes(seen, current):
    summary, switches = [], []
    for version in sorted(WHATS_NEW, key=parse):
        if parse(seen) < parse(version) <= parse(current):
            summary += WHATS_NEW[version]["summary"]
            switches += WHATS_NEW[version]["switches"]
    return summary, switches


def status():
    current = current_version()
    local = read_json(kit_config.user_profile_path())
    seen = local.get("kit_version") or (BEFORE_TRACKING if local else "")
    summary, switches = changes(seen or BEFORE_TRACKING, current)
    off = [s for s in switches if (local.get("settings") or {}).get(s) is False]
    return {"kit": current, "profile_saved_with": seen or None, "new": summary,
            "new_switches": switches, "switched_off_by_owner": off, "stale_installs": stale_installs(current)}


def stamp(path, data, current):
    data["kit_version"] = current
    try:
        with open(path, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(data, fh, indent=2, ensure_ascii=False)
            fh.write("\n")
        return True
    except OSError:
        return False


def notice():
    if os.environ.get("SABRY_KIT_UPDATE_NOTICE", "").strip().lower() in kit_config.FALSE:
        return ""
    current = current_version()
    path = kit_config.user_profile_path()
    local = read_json(path)
    if not current or not local:
        return ""
    seen = local.get("kit_version") or BEFORE_TRACKING
    if parse(seen) >= parse(current):
        return ""
    summary, switches = changes(seen, current)
    stale = stale_installs(current)
    if not stamp(path, local, current):
        return ""
    if not summary and not stale:
        return ""
    script = os.path.join(KIT, "hooks", "kit_install.py").replace("\\", "/")
    lines = [f"[kit-update] sabry-kit is now {current}; the owner's profile was saved with {seen}. Their own "
             "choices are unchanged. In your first reply, tell the owner in at most four short lines, in "
             "their language:"]
    if summary:
        lines.append("- New: " + " · ".join(summary) + ".")
    if switches:
        lines.append("- New switches, on by default: " + ", ".join(f"`{s}`" for s in switches)
                     + ". `/sabry-kit:kit-setup` turns any of them off.")
    if stale:
        lines.append("- Installed copies in other tools are older and need a refresh: "
                     + " · ".join(f'`python3 "{script}" --target {t}`' for t in stale) + ".")
    lines.append("Say it once; this note does not repeat for this version.")
    return "\n".join(lines)


def main():
    if sys.argv[1:2] == ["status"]:
        print(json.dumps(status(), indent=2, ensure_ascii=False))
        return 0
    text = notice()
    if text:
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": text}},
                         ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        sys.exit(0)
